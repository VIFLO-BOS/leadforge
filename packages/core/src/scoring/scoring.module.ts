import { Module } from "@nestjs/common";
import { BusinessesModule } from "../businesses/businesses.module.js";
import { ScoringQueueHandler } from "./scoring.queue-handler.js";
import { ScoringService } from "./scoring.service.js";
import { ScoringProfileRepository } from "./repositories/scoring-profile.repository.js";

/** Scoring profiles and score snapshots. Owns scoring_profiles; writes scores through BusinessesService. */
@Module({
  imports: [BusinessesModule],
  providers: [ScoringService, ScoringQueueHandler, ScoringProfileRepository],
  exports: [ScoringService, ScoringQueueHandler],
})
export class ScoringModule {}
