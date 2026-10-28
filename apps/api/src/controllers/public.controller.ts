import { Controller, Get, Header, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import {
  ContactRequest,
  DataLicensesResponse,
  PublicPlansResponse,
  SourceRegistryEntry,
} from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodResponse,
  AppError,
  ContactService,
  DataLicensesService,
  PlansService,
  Public,
  SourcesService,
  SkipCsrf,
  ZodBody,
  clientIp,
} from "@leadforge/core";

@ApiTags("public")
@Controller("public")
@Public()
export class PublicController {
  constructor(
    private readonly plans: PlansService,
    private readonly contact: ContactService,
    private readonly sources: SourcesService,
    private readonly licenses: DataLicensesService,
  ) {}

  /**
   * Data sources and licences page: licence texts (links), attribution lines, the Foursquare
   * NOTICE, LeadForge's changes and the disclaimer (CDLA-Permissive-2.0 section 2.1, Apache-2.0
   * section 4). Public so exports and the marketing site can link to it.
   */
  @Get("data-licenses")
  @Header("Cache-Control", "public, max-age=3600")
  @ApiZodResponse(200, DataLicensesResponse)
  dataLicenses() {
    return this.licenses.overview();
  }

  /** The Foursquare NOTICE as plain text (`NOTICE.txt` for Foursquare-derived records). */
  @Get("data-licenses/notices/foursquare")
  @Header("Cache-Control", "public, max-age=86400")
  foursquareNotice(@Res() res: Response) {
    res.type("text/plain; charset=utf-8").send(this.licenses.noticeText());
  }

  /** One licence's full text as plain text, e.g. /public/data-licenses/CDLA-Permissive-2.0. */
  @Get("data-licenses/:id")
  @Header("Cache-Control", "public, max-age=86400")
  licenseText(@Param("id") id: string, @Res() res: Response) {
    const text = this.licenses.text(id);
    if (!text) throw AppError.notFound("Licence");
    res.type("text/plain; charset=utf-8").send(text);
  }

  /** Source registry with coverage and data policy for the marketing site (no organization settings). */
  @Get("sources")
  @ApiZodResponse(200, SourceRegistryEntry.array())
  async listSources() {
    const items = (await this.sources.list()).map((s) => ({ ...s, config: null }));
    return { items };
  }

  @Get("plans")
  @ApiZodResponse(200, PublicPlansResponse)
  listPlans() {
    return this.plans.listPublic();
  }

  @Post("contact")
  @SkipCsrf()
  @Throttle({ default: { limit: 3, ttl: 60 * 60_000 } })
  @HttpCode(202)
  @ApiZodBody(ContactRequest)
  submitContact(@ZodBody(ContactRequest) body: ContactRequest, @Req() req: Request) {
    return this.contact.submit(body, clientIp(req));
  }
}
