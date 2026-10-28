import { Controller, Get } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CreditBalance, CreditLedgerEntry, CreditLedgerQuery } from "@leadforge/contracts";
import {
  ApiZodQuery,
  ApiZodResponse,
  CreditsService,
  CurrentOrg,
  RequirePermission,
  ZodQuery,
  type OrganizationScope,
} from "@leadforge/core";
import { paged } from "../common/envelope.interceptor.js";

// Type-only alias keeps the Zod schema out of Swagger's query-parameter expansion.
type LedgerQuery = CreditLedgerQuery;

@ApiTags("credits")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller("credits")
export class CreditsController {
  constructor(private readonly credits: CreditsService) {}

  @Get("balance")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary: "Spendable credits and credits held by running jobs (PostgreSQL ledger)",
  })
  @ApiZodResponse(200, CreditBalance)
  balance(@CurrentOrg() org: OrganizationScope) {
    return this.credits.balance(org.organizationId);
  }

  @Get("ledger")
  @RequirePermission("usage:read")
  @ApiOperation({ summary: "Credit ledger, newest first (Usage page)" })
  @ApiZodQuery(CreditLedgerQuery)
  @ApiZodResponse(200, CreditLedgerEntry.array())
  async ledger(
    @CurrentOrg() org: OrganizationScope,
    @ZodQuery(CreditLedgerQuery) query: LedgerQuery,
  ) {
    const page = await this.credits.listLedger(org.organizationId, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }
}
