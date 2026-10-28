import { Module } from "@nestjs/common";
import { ProvenanceService } from "./provenance.service.js";
import { ObservationRepository } from "./repositories/observation.repository.js";
import { VerificationEventRepository } from "./repositories/verification-event.repository.js";

/** Owns source_observations and verification_events. Other modules use ProvenanceService. */
@Module({
  providers: [ProvenanceService, ObservationRepository, VerificationEventRepository],
  exports: [ProvenanceService],
})
export class ProvenanceModule {}
