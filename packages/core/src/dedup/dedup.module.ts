import { Module } from "@nestjs/common";
import { BusinessesModule } from "../businesses/businesses.module.js";
import { DedupQueueHandler } from "./dedup.queue-handler.js";
import { DedupService } from "./dedup.service.js";
import { DuplicateCandidateRepository } from "./repositories/duplicate-candidate.repository.js";
import { MergeHistoryRepository } from "./repositories/merge-history.repository.js";

/**
 * Dedup stages 4 to 6: similarity candidates, the review queue, merge and undo. Owns
 * duplicate_candidates and merge_history; reads and writes businesses through BusinessesService.
 */
@Module({
  imports: [BusinessesModule],
  providers: [
    DedupService,
    DedupQueueHandler,
    DuplicateCandidateRepository,
    MergeHistoryRepository,
  ],
  exports: [DedupService, DedupQueueHandler],
})
export class DedupModule {}
