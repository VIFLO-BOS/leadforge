import { Module } from "@nestjs/common";
import { CreditsService } from "./credits.service.js";
import { CreditLedgerRepository } from "./repositories/credit-ledger.repository.js";

/** Credit ledger, holds, captures, releases and balance (PostgreSQL only). */
@Module({ providers: [CreditsService, CreditLedgerRepository], exports: [CreditsService] })
export class CreditsModule {}
