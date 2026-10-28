import { Inject, Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import type { ObjectId, WithId } from "@leadforge/db-mongo";
import {
  ObjectIdString,
  roleHasPermission,
  UuidString,
  type ServerEnv,
} from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { BusinessesService } from "../businesses/businesses.service.js";
import {
  isExpired,
  observationDoc,
  SOURCE_CONFIDENCE,
  type ProvenanceContext,
  type WebsiteContactsInput,
} from "../businesses/business-model.js";
import type { BusinessDocument } from "../businesses/business.types.js";
import { ProvenanceService } from "../provenance/provenance.service.js";
import { deterministicObjectId, type ObservationDocument } from "../provenance/provenance.types.js";
import { checkEmail } from "../normalization/email-checks.js";
import { DNS_RESOLVER } from "../safe-fetch/safe-fetch.module.js";
import type { DnsResolver } from "../safe-fetch/safe-fetch.js";
import { SiteCrawler, sameSite } from "../safe-fetch/site-crawler.js";
import type { EnrichmentRunJob } from "../queue/queue.constants.js";
import { extractContacts, mergePageContacts, type ContactEvidence } from "./contact-extractor.js";
import { emptyRunOutput, type EnrichmentRunDocument } from "./enrichment.types.js";
import { EnrichmentRunRepository } from "./repositories/enrichment-run.repository.js";

export class EnrichmentPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnrichmentPayloadError";
  }
}

export class EnrichmentRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnrichmentRetryableError";
  }
}

export type EnrichmentOutcome =
  | { kind: "completed"; output: EnrichmentRunDocument["output"] }
  | { kind: "failed"; code: string; message: string; output?: EnrichmentRunDocument["output"] };

/** Email checks per run (found on the site plus never-checked addresses already on the business). */
const MAX_EMAIL_CHECKS = 10;

/**
 * Enrichment runs in the worker (queue `enrichment`):
 * - `website-contacts`: crawls the business's own site through SafeFetch (home, contact and
 *   about pages), extracts mailto, tel, WhatsApp and social links with evidence, records them as
 *   `website` observations, marks phones `verified` (valid number found on the own site) and
 *   WhatsApp `confirmed` (explicit link or label on the own site), then checks emails.
 * - `verify-contact`: the release 1 email checks (syntax, MX, disposable) for one address.
 * Email checks are recorded as verification events and never make an email `verified`.
 * Observation and event ids derive from the run, so a retried job writes nothing twice.
 */
@Injectable()
export class EnrichmentRunner {
  constructor(
    private readonly runs: EnrichmentRunRepository,
    private readonly businesses: BusinessesService,
    private readonly provenance: ProvenanceService,
    private readonly organizations: OrganizationsService,
    private readonly crawler: SiteCrawler,
    @Inject(DNS_RESOLVER) private readonly dns: DnsResolver,
    private readonly logger: Logger,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  private async load(
    organizationId: string,
    runId: string,
  ): Promise<WithId<EnrichmentRunDocument>> {
    if (!UuidString.safeParse(organizationId).success || !ObjectIdString.safeParse(runId).success) {
      throw new EnrichmentPayloadError("Invalid enrichment payload");
    }
    const run = await this.runs.findById(organizationId, runId);
    if (!run)
      throw new EnrichmentPayloadError("Enrichment run not found in the payload's organization");
    return run;
  }

  async run(payload: EnrichmentRunJob): Promise<{ status: string }> {
    const run = await this.load(payload.organizationId, payload.runId);
    const org = run.organizationId;
    if (run.status === "completed" || run.status === "failed")
      return { status: `noop: ${run.status}` };
    const member = await this.organizations.isActiveMember(org, run.requestedByUserId);
    if (!member.active || !member.role || !roleHasPermission(member.role, "analysis:run")) {
      await this.finalize(org, run._id, {
        kind: "failed",
        code: "ACCESS_REVOKED",
        message: "The requester is no longer a member with permission to run enrichment.",
      });
      return { status: "failed" };
    }
    const business = await this.businesses.findAny(org, run.businessId);
    if (!business || business.deletedAt) {
      await this.finalize(org, run._id, {
        kind: "failed",
        code: "BUSINESS_GONE",
        message: "The business was deleted or merged before the run started.",
      });
      return { status: "failed" };
    }
    const now = new Date();
    const started = await this.runs.transition(org, run._id, ["queued", "running"], {
      $set: { status: "running", startedAt: run.startedAt ?? now, updatedAt: now },
      $inc: { attempts: 1 },
    });
    if (!started) return { status: "noop: already finished" };
    const outcome =
      run.kind === "website_contacts"
        ? await this.websiteContacts(started, business)
        : await this.emailCheck(started, business);
    await this.finalize(org, run._id, outcome);
    return { status: outcome.kind };
  }

  private async websiteContacts(
    run: EnrichmentRunDocument,
    business: BusinessDocument,
  ): Promise<EnrichmentOutcome> {
    const org = run.organizationId;
    if (business.flags.suppressed)
      return {
        kind: "failed",
        code: "SUPPRESSED",
        message: "The business is suppressed; its website is not fetched.",
      };
    if (!business.website || isExpired(business.website.expiresAt))
      return {
        kind: "failed",
        code: "WEBSITE_MISSING",
        message: "The business has no website on record.",
      };
    const crawl = await this.crawler.crawl(business.website.value, {
      maxPages: 3,
      follow: ["contact", "about"],
      retries: 1,
      retryDelayMs: this.env.SAFE_FETCH_RETRY_DELAY_MS,
    });
    const output = emptyRunOutput();
    output.pagesVisited = crawl.pages.map((p) => ({
      url: p.finalUrl ?? p.url,
      status: p.status,
      error: p.error ? `${p.error.code}: ${p.error.message}` : null,
    }));
    if (crawl.homeFailure?.code === "RATE_LIMITED")
      throw new EnrichmentRetryableError(crawl.homeFailure.message);
    if (!crawl.home || !crawl.home.doc) {
      const f = crawl.homeFailure;
      return {
        kind: "failed",
        code: f?.code ?? "FETCH_FAILED",
        message: f?.message ?? "The website could not be read",
        output,
      };
    }

    const settings = await this.organizations.getDataSettings(org);
    const country = business.location.country ?? settings.country;
    const homeHost = new URL(crawl.home.finalUrl ?? crawl.home.url).hostname;
    const ownSite = sameSite(homeHost, business.website.domain);
    output.ownSite = ownSite;
    const contacts = mergePageContacts(
      crawl.pages.filter((p) => p.doc).map((p) => extractContacts(p.doc!, country)),
    );

    const collectedAt = new Date();
    const ctx: ProvenanceContext = {
      source: "website",
      collectionMethod: "website_fetch",
      sourceRef: crawl.home.finalUrl ?? crawl.home.url,
      collectedAt,
      confidence: SOURCE_CONFIDENCE.website,
      actor: { type: "system", userId: null },
      importId: null,
      note: null,
      idSeed: null,
      enrichmentRunId: run._id,
    };
    const seed = `enrichment:${run._id.toHexString()}`;
    let n = 0;
    const observations: ObservationDocument[] = [];
    const record = (
      field: ObservationDocument["field"],
      fieldKey: string | null,
      raw: string | null,
      normalized: ObservationDocument["normalizedValue"],
      evidence: ContactEvidence,
      metadata: Record<string, unknown> = {},
    ) => {
      const id = deterministicObjectId(`${seed}:obs:${n++}`, run.createdAt);
      observations.push(
        observationDoc(
          org,
          business._id,
          { ...ctx, sourceRef: evidence.page },
          {
            _id: id,
            field,
            fieldKey,
            rawValue: raw,
            normalizedValue: normalized,
            action: "set",
            metadata: { ...metadata, evidence, ownSite },
          },
        ),
      );
      return id;
    };

    const input: WebsiteContactsInput = {
      ownSite,
      phones: [],
      emails: [],
      socials: [],
      whatsapp: [],
    };
    for (const p of contacts.phones) {
      const obsId = record("phone", p.phone.e164, p.raw, p.phone.e164, p.evidence, {
        type: p.phone.type,
        country: p.phone.country,
      });
      input.phones.push({ phone: { ...p.phone, raw: p.raw, whatsapp: "unknown" }, obsId });
    }
    const whatsappMethod = new Map<string, "wa_link" | "explicit_label">();
    for (const w of contacts.whatsapp) {
      const obsId = record(
        "whatsapp",
        w.phone?.e164 ?? null,
        w.raw,
        w.phone?.e164 ?? null,
        w.evidence,
        { method: w.method },
      );
      if (w.phone && !whatsappMethod.has(w.phone.e164)) {
        whatsappMethod.set(w.phone.e164, w.method);
        input.whatsapp.push({ e164: w.phone.e164, obsId });
      }
    }
    for (const e of contacts.emails) {
      const obsId = record("email", e.address, e.raw, e.address, e.evidence);
      input.emails.push({ email: { address: e.address, domain: e.domain, raw: e.raw }, obsId });
    }
    for (const s of contacts.socials) {
      const obsId = record("social", s.url, s.raw, s.url, s.evidence, { platform: s.platform });
      input.socials.push({
        social: { platform: s.platform, url: s.url, handle: s.handle, raw: s.raw },
        obsId,
      });
    }

    const { change, business: updated } = await this.businesses.applyWebsiteContacts(
      org,
      business._id,
      input,
      ctx,
      observations,
    );

    let k = 0;
    const eventId = () => deterministicObjectId(`${seed}:ve:${k++}`, run.createdAt);
    const pageOf = (e164: string) =>
      contacts.phones.find((p) => p.phone.e164 === e164)?.evidence.page ?? ctx.sourceRef;
    for (const e164 of change.phonesVerified) {
      const p = contacts.phones.find((x) => x.phone.e164 === e164);
      await this.provenance.recordVerificationEvent(
        org,
        {
          businessId: business._id,
          field: "phone",
          fieldKey: e164,
          method: "website_presence",
          result: "passed",
          details: `Valid number for its numbering plan${p?.phone.country ? ` (${p.phone.country})` : ""}, listed on the business's own website (${pageOf(e164)})`,
          actorType: "system",
          actorId: null,
          occurredAt: collectedAt,
        },
        eventId(),
      );
    }
    for (const e164 of change.whatsappConfirmed) {
      const w = contacts.whatsapp.find((x) => x.phone?.e164 === e164);
      await this.provenance.recordVerificationEvent(
        org,
        {
          businessId: business._id,
          field: "whatsapp",
          fieldKey: e164,
          method: whatsappMethod.get(e164) === "wa_link" ? "whatsapp_link" : "whatsapp_label",
          result: "passed",
          details:
            whatsappMethod.get(e164) === "wa_link"
              ? `WhatsApp click-to-chat link on the business's own website (${w?.evidence.page ?? ctx.sourceRef})`
              : `Number labeled "WhatsApp" on the business's own website (${w?.evidence.page ?? ctx.sourceRef})`,
          actorType: "system",
          actorId: null,
          occurredAt: collectedAt,
        },
        eventId(),
      );
    }

    // Email checks: addresses found now, plus addresses on the business that were never checked.
    const addresses = [
      ...new Set([
        ...contacts.emails.map((e) => e.address),
        ...updated.emails.filter((e) => !e.verification).map((e) => e.address),
      ]),
    ].slice(0, MAX_EMAIL_CHECKS);
    output.emailChecks = await this.checkEmails(run, business._id, addresses, eventId);

    output.observationIds = observations.map((o) => o._id);
    output.found = {
      phones: contacts.phones.length,
      emails: contacts.emails.length,
      socials: contacts.socials.length,
      whatsapp: contacts.whatsapp.length,
    };
    output.phonesVerified = change.phonesVerified.length;
    output.whatsappConfirmed = change.whatsappConfirmed.length;
    return { kind: "completed", output };
  }

  private async emailCheck(
    run: EnrichmentRunDocument,
    business: BusinessDocument,
  ): Promise<EnrichmentOutcome> {
    const address = run.input.address ?? "";
    const output = emptyRunOutput();
    if (!business.emails.some((e) => e.address === address)) {
      return {
        kind: "failed",
        code: "EMAIL_NOT_ON_BUSINESS",
        message: "That email address is no longer on this business.",
        output,
      };
    }
    let k = 0;
    const eventId = () =>
      deterministicObjectId(`enrichment:${run._id.toHexString()}:ve:${k++}`, run.createdAt);
    output.emailChecks = await this.checkEmails(run, business._id, [address], eventId);
    return { kind: "completed", output };
  }

  /** Syntax, MX and disposable checks: one verification event per step, a summary on the email. */
  private async checkEmails(
    run: EnrichmentRunDocument,
    businessId: ObjectId,
    addresses: string[],
    eventId: () => ObjectId,
  ) {
    const results: EnrichmentRunDocument["output"]["emailChecks"] = [];
    const summaries: Array<{
      address: string;
      verification: { method: string; result: string; checkedAt: Date };
    }> = [];
    for (const address of addresses) {
      const report = await checkEmail(address, this.dns);
      const checkedAt = new Date();
      for (const step of report.steps) {
        await this.provenance.recordVerificationEvent(
          run.organizationId,
          {
            businessId,
            field: "email",
            fieldKey: report.address,
            method: step.method,
            result: step.result,
            details: step.details,
            actorType: "system",
            actorId: null,
            occurredAt: checkedAt,
          },
          eventId(),
        );
      }
      results.push({ address: report.address, result: report.outcome });
      summaries.push({
        address: report.address,
        verification: { method: "syntax_mx_disposable", result: report.outcome, checkedAt },
      });
    }
    await this.businesses.recordEmailChecks(run.organizationId, businessId, summaries);
    return results;
  }

  async finalize(
    organizationId: string,
    id: ObjectId,
    outcome: EnrichmentOutcome,
  ): Promise<boolean> {
    const now = new Date();
    const done = await this.runs.transition(organizationId, id, ["queued", "running"], {
      $set: {
        status: outcome.kind,
        ...(outcome.output ? { output: outcome.output } : {}),
        error:
          outcome.kind === "failed"
            ? { code: outcome.code, message: outcome.message.slice(0, 500) }
            : null,
        finishedAt: now,
        updatedAt: now,
      },
      $unset: { active: "" },
    });
    if (done)
      this.logger.log(
        {
          organizationId,
          runId: id.toHexString(),
          kind: done.kind,
          status: done.status,
          error: done.error?.code ?? null,
        },
        "Enrichment run finished",
      );
    return Boolean(done);
  }
}
