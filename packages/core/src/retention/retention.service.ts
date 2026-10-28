import { Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { BusinessesService } from "../businesses/businesses.service.js";
import { ProvenanceService } from "../provenance/provenance.service.js";

export interface PurgeReport {
  observationsRedacted: number;
  businessesChecked: number;
  businessesPurged: number;
}

/**
 * Source retention enforcement (security policy section 7, data minimization). Runs every 10
 * minutes (`purge-expired-content` on the maintenance queue): observation values past
 * `policy.retainValueUntil` are redacted (metadata kept), and expired values are removed from
 * business records. Reads already hide expired values before this runs.
 */
@Injectable()
export class RetentionService {
  constructor(
    private readonly businesses: BusinessesService,
    private readonly provenance: ProvenanceService,
    private readonly logger: Logger,
  ) {}

  async purgeExpired(now: Date = new Date()): Promise<PurgeReport> {
    const observationsRedacted = await this.provenance.redactExpiredObservations(now);
    const { checked, purged } = await this.businesses.purgeExpiredValues(now);
    const report = { observationsRedacted, businessesChecked: checked, businessesPurged: purged };
    if (observationsRedacted > 0 || purged > 0)
      this.logger.log(report, "Expired source content purged");
    return report;
  }
}
