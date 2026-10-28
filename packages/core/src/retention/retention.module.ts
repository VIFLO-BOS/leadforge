import { Module } from "@nestjs/common";
import { BusinessesModule } from "../businesses/businesses.module.js";
import { ProvenanceModule } from "../provenance/provenance.module.js";
import { RetentionService } from "./retention.service.js";

/** Enforces source retention windows (redaction and removal of expired values). */
@Module({
  imports: [BusinessesModule, ProvenanceModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
