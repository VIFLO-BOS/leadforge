import { Controller, Headers, HttpCode, Post, Req, type RawBodyRequest } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request } from "express";
import { WebhookAck } from "@leadforge/contracts";
import { ApiZodResponse, getRequestId, Public, SkipCsrf, WebhookService } from "@leadforge/core";

/**
 * Payment provider webhooks. Public (Paystack calls it) but authenticated by the
 * `x-paystack-signature` HMAC over the exact raw body: the app is created with Nest's `rawBody`
 * option, so the JSON parser keeps the original bytes on `req.rawBody` and the signature is never
 * computed over re-serialized JSON. Answers 200 as soon as the event is stored; the worker does
 * the rest. Hidden from the public API docs.
 */
@ApiExcludeController()
@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly webhooks: WebhookService) {}

  @Post("paystack")
  @Public()
  @SkipCsrf()
  @HttpCode(200)
  @ApiZodResponse(200, WebhookAck)
  paystack(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-paystack-signature") signature: string | undefined,
  ) {
    return this.webhooks.ingest({
      rawBody: req.rawBody,
      signature,
      ip: req.ip,
      requestId: getRequestId(req),
    });
  }
}
