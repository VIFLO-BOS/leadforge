import { Injectable } from "@nestjs/common";
import type { WithId } from "@leadforge/db-mongo";
import type { PipelineConfig, UpdatePipelineConfigRequest } from "@leadforge/contracts";
import { AppError } from "../common/errors/app.error.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import type { PipelineConfigDocument } from "./crm.types.js";
import { toConfigView, toStageView } from "./crm-view.js";
import { defaultStages, planPipelineUpdate, sortedStages } from "./pipeline-rules.js";
import { PipelineConfigRepository } from "./repositories/pipeline-config.repository.js";
import { LeadRepository } from "./repositories/lead.repository.js";

export function versionConflict(what: string, currentVersion: number | null): AppError {
  return new AppError(
    "VERSION_CONFLICT",
    `The ${what} changed since you loaded it. Reload and try again.`,
    currentVersion === null ? undefined : [{ path: "version", message: String(currentVersion) }],
  );
}

/**
 * Pipeline stages per organization. Created with the default stages (New, Qualified,
 * Contacted, Interested, Opportunity, Won, Lost) on first use. Owners and administrators
 * rename, reorder, add and archive stages; won and lost keep their meaning.
 */
@Injectable()
export class PipelineService {
  constructor(
    private readonly configs: PipelineConfigRepository,
    private readonly leads: LeadRepository,
    private readonly audit: AuditService,
  ) {}

  config(organizationId: string): Promise<WithId<PipelineConfigDocument>> {
    return this.configs.findOrCreate(organizationId, defaultStages());
  }

  async getConfig(organizationId: string): Promise<PipelineConfig> {
    return toConfigView(await this.config(organizationId));
  }

  async updateConfig(
    organizationId: string,
    userId: string,
    req: UpdatePipelineConfigRequest,
    auditCtx: AuditContext,
  ): Promise<PipelineConfig> {
    const current = await this.config(organizationId);
    if (current.version !== req.version)
      throw versionConflict("pipeline configuration", current.version);
    const plan = planPipelineUpdate(current.stages, req);
    if (!plan.ok)
      throw AppError.validation(plan.details, "The pipeline configuration is not valid");
    for (const key of plan.archivedNow) {
      const count = await this.leads.countMatching(organizationId, { stageKey: key });
      if (count > 0) {
        const label = current.stages.find((s) => s.key === key)?.label ?? key;
        throw new AppError(
          "STAGE_NOT_EMPTY",
          `"${label}" still holds ${count} lead${count === 1 ? "" : "s"}; move them to another stage before archiving it.`,
          [
            { path: "stageKey", message: key },
            { path: "leads", message: String(count) },
          ],
        );
      }
    }
    const saved = await this.configs.replaceStages(
      organizationId,
      req.version,
      plan.stages,
      userId,
    );
    if (!saved)
      throw versionConflict("pipeline configuration", (await this.config(organizationId)).version);
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "pipeline.config_updated",
        resourceType: "pipeline_config",
        resourceId: saved._id.toHexString(),
        before: { version: current.version, stages: sortedStages(current.stages).map(toStageView) },
        after: { version: saved.version, stages: sortedStages(saved.stages).map(toStageView) },
      },
      auditCtx,
    );
    return toConfigView(saved);
  }
}
