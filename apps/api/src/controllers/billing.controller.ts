import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
  StreamableFile,
  UseFilters,
} from "@nestjs/common";
import { z } from "zod";
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Request, Response } from "express";
import {
  BillingBanners,
  BillingCatalogue,
  BillingOverview,
  CancelSubscriptionRequest,
  CheckoutCreditsRequest,
  CheckoutSession,
  CheckoutSubscriptionRequest,
  IDEMPOTENCY_KEY_HEADER,
  InvoiceDownloadLink,
  InvoiceDownloadQuery,
  InvoiceListQuery,
  InvoiceView,
  PaymentListQuery,
  PaymentReference,
  PaymentView,
  RefundRequest,
  SubscriptionManageLink,
  SubscriptionView,
  UuidString,
  VerifyPaymentResponse,
} from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  AppError,
  AuditService,
  AuthOnly,
  BillingService,
  CurrentOrg,
  CurrentUser,
  InvoiceService,
  RequirePermission,
  ZodBody,
  ZodParam,
  ZodQuery,
  type AuthenticatedUser,
  type OrganizationScope,
  PausedDuringDeletionGrace,
} from "@leadforge/core";
import { paged } from "../common/envelope.interceptor.js";
import { IDEMPOTENCY_KEY_PATTERN } from "../common/actor.js";
import { InvoiceDownloadRedirectFilter } from "../common/download-redirect.filter.js";

// Type-only aliases keep Zod schemas out of Swagger's query-parameter expansion.
type PaymentsQuery = PaymentListQuery;
type InvoicesQuery = InvoiceListQuery;
type DownloadQuery = InvoiceDownloadQuery;

/** The cancel body is optional (`{}` or `{ atPeriodEnd: true }`). */
const CancelBody = z.preprocess((v) => v ?? {}, CancelSubscriptionRequest);

function requireIdempotencyKey(key: string | undefined): string {
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw AppError.validation([
      {
        path: "Idempotency-Key",
        message:
          "Send an Idempotency-Key header of 8 to 128 letters, digits or - _ . : (one per checkout click)",
      },
    ]);
  }
  return key;
}

/**
 * Billing (Phase 6). Owners and admins manage billing (`billing:manage`); refunds are owner-only
 * (`billing:refund`); banners are for every member. Prices come from the database; nothing is
 * granted by a request here.
 */
@ApiTags("billing")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description:
    "Organization scope; membership is verified server-side (not needed on the signed invoice download)",
})
@Controller("billing")
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly invoices: InvoiceService,
  ) {}

  @Get("overview")
  @RequirePermission("billing:manage")
  @ApiOperation({
    summary:
      "Billing page: provider status, subscription, entitlements, credits, members, latest payment, banners",
    description:
      "Stage 9: pendingSubscription.authorizationUrl (with authorizationUrlExpiresAt) is the stored Paystack checkout of an incomplete subscription, present only while its payment is pending, not under review, Paystack is configured, and it started less than CHECKOUT_RESUME_WINDOW_MINUTES (30) ago; never once the payment is final. Send the browser there to resume the checkout; when absent, start a new one.",
  })
  @ApiZodResponse(200, BillingOverview)
  overview(@CurrentOrg() org: OrganizationScope) {
    return this.billing.overview(org.organizationId, org.permissions);
  }

  @Get("banners")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary: "In-app billing banners for the viewer (every role)",
    description:
      "negative_balance for everyone (it pauses discovery and analyses); not_configured, past_due and payment_failed for owners and admins only.",
  })
  @ApiZodResponse(200, BillingBanners)
  async banners(@CurrentOrg() org: OrganizationScope) {
    return { banners: await this.billing.banners(org.organizationId, org.permissions) };
  }

  @Get("plans")
  @RequirePermission("billing:manage")
  @ApiOperation({
    summary:
      "Plans and credit packs with whether each can be bought now (placeholder prices cannot on a live key)",
  })
  @ApiZodResponse(200, BillingCatalogue)
  plans(@CurrentOrg() org: OrganizationScope) {
    return this.billing.catalogue(org.organizationId);
  }

  @Post("checkout/credits")
  @RequirePermission("billing:manage")
  @PausedDuringDeletionGrace()
  @HttpCode(201)
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "8-128 characters, one per click; a repeat returns the same checkout (200)",
  })
  @ApiOperation({
    summary: "Start a hosted Paystack checkout for a credit pack",
    description:
      "Returns `authorizationUrl` (send the browser there) and `reference`. Paystack returns the browser to /app/billing/return?reference=...; nothing is granted until the payment is verified with Paystack. Errors: 422 BILLING_NOT_CONFIGURED, 422 PRICE_NOT_PUBLISHED, 404 (pack), 409 CONFLICT (key reused for another item), 502 PAYMENT_PROVIDER_ERROR, 400 (missing key).",
  })
  @ApiZodBody(CheckoutCreditsRequest)
  @ApiZodResponse(201, CheckoutSession)
  async checkoutCredits(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(CheckoutCreditsRequest) body: CheckoutCreditsRequest,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { session, replayed } = await this.billing.checkoutCredits(
      org.organizationId,
      user.id,
      body.packId,
      requireIdempotencyKey(key),
      AuditService.contextFrom(req),
    );
    if (replayed) res.status(200);
    return session;
  }

  @Post("checkout/subscription")
  @RequirePermission("billing:manage")
  @PausedDuringDeletionGrace()
  @HttpCode(201)
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "8-128 characters, one per click; a repeat returns the same checkout (200)",
  })
  @ApiOperation({
    summary:
      "Start a hosted Paystack checkout that subscribes to a plan (also used to change plan)",
    description:
      "Creates an `incomplete` subscription and a pending payment; the plan becomes active (and replaces any other plan) only after the first payment is verified. Errors: 422 BILLING_NOT_CONFIGURED, 422 PRICE_NOT_PUBLISHED, 404 (plan), 409 CONFLICT (already on this plan, or key reused), 502 PAYMENT_PROVIDER_ERROR.",
  })
  @ApiZodBody(CheckoutSubscriptionRequest)
  @ApiZodResponse(201, CheckoutSession)
  async checkoutSubscription(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(CheckoutSubscriptionRequest) body: CheckoutSubscriptionRequest,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { session, replayed } = await this.billing.checkoutSubscription(
      org.organizationId,
      user.id,
      body.planId,
      requireIdempotencyKey(key),
      AuditService.contextFrom(req),
    );
    if (replayed) res.status(200);
    return session;
  }

  @Get("payments")
  @RequirePermission("billing:manage")
  @ApiOperation({ summary: "Payments, newest first" })
  @ApiZodQuery(PaymentListQuery)
  @ApiZodResponse(200, PaymentView.array())
  async payments(
    @CurrentOrg() org: OrganizationScope,
    @ZodQuery(PaymentListQuery) query: PaymentsQuery,
  ) {
    const page = await this.billing.listPayments(org.organizationId, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }

  @Get("payments/:reference")
  @RequirePermission("billing:manage")
  @ApiOperation({
    summary:
      "One payment by reference or id (the return page polls this every 2 s until the status is final)",
  })
  @ApiZodResponse(200, PaymentView)
  payment(
    @CurrentOrg() org: OrganizationScope,
    @ZodParam("reference", PaymentReference) reference: string,
  ) {
    return this.billing.getPayment(org.organizationId, reference);
  }

  @Post("payments/:reference/verify")
  @RequirePermission("billing:manage")
  @HttpCode(202)
  @ApiOperation({
    summary:
      "Ask the worker to verify a pending payment with Paystack (the return page calls this once)",
    description:
      "Never grants in the request: the worker verifies and settles. `queued: false` when the payment is already final or under review. 422 BILLING_NOT_CONFIGURED.",
  })
  @ApiZodResponse(202, VerifyPaymentResponse)
  verify(
    @CurrentOrg() org: OrganizationScope,
    @ZodParam("reference", PaymentReference) reference: string,
  ) {
    return this.billing.requestVerification(org.organizationId, reference);
  }

  @Post("payments/:id/refund")
  @RequirePermission("billing:refund")
  @HttpCode(202)
  @ApiOperation({
    summary: "Refund all or part of a successful payment (owner)",
    description:
      "Sent to Paystack now; the refund is `pending` until Paystack confirms it (refund.processed), when the credits the payment bought are taken back in proportion (the balance can go below zero, which pauses new discovery and analyses). Errors: 409 CONFLICT (not refundable), 400 (amount above what is left), 422 BILLING_NOT_CONFIGURED, 502 PAYMENT_PROVIDER_ERROR.",
  })
  @ApiZodBody(RefundRequest)
  @ApiZodResponse(202, PaymentView)
  refund(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", UuidString) id: string,
    @ZodBody(RefundRequest) body: RefundRequest,
    @Req() req: Request,
  ) {
    return this.billing.requestRefund(
      org.organizationId,
      user.id,
      id,
      body,
      AuditService.contextFrom(req),
    );
  }

  @Get("invoices")
  @RequirePermission("billing:manage")
  @ApiOperation({ summary: "Invoices, newest first" })
  @ApiZodQuery(InvoiceListQuery)
  @ApiZodResponse(200, InvoiceView.array())
  async listInvoices(
    @CurrentOrg() org: OrganizationScope,
    @ZodQuery(InvoiceListQuery) query: InvoicesQuery,
  ) {
    const page = await this.billing.listInvoices(org.organizationId, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }

  @Get("invoices/:id")
  @RequirePermission("billing:manage")
  @ApiOperation({ summary: "One invoice" })
  @ApiZodResponse(200, InvoiceView)
  invoice(@CurrentOrg() org: OrganizationScope, @ZodParam("id", UuidString) id: string) {
    return this.billing.getInvoice(org.organizationId, id);
  }

  @Get("invoices/:id/download-url")
  @RequirePermission("billing:manage")
  @ApiOperation({
    summary:
      "A signed PDF download link for the caller (valid 15 minutes); navigate the browser to `url`",
  })
  @ApiZodResponse(200, InvoiceDownloadLink)
  invoiceDownloadUrl(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", UuidString) id: string,
  ) {
    return this.billing.invoiceDownloadLink(org.organizationId, user.id, id);
  }

  @Get("invoices/:id/download")
  @AuthOnly()
  @UseFilters(InvoiceDownloadRedirectFilter)
  @ApiOperation({
    summary:
      "Download the invoice PDF through a signed link (signed in; the link names the organization)",
    description:
      "403 DOWNLOAD_LINK_INVALID (tampered, or issued to someone else), 410 DOWNLOAD_LINK_EXPIRED, 403 ORG_FORBIDDEN or FORBIDDEN (no longer a billing manager). Audited. A browser navigation (Sec-Fetch-Mode: navigate, or Accept preferring text/html) that fails with DOWNLOAD_LINK_INVALID or DOWNLOAD_LINK_EXPIRED (a damaged link counts as DOWNLOAD_LINK_INVALID) gets 303 See Other to <APP_URL>/app/billing?downloadError=<code> instead, and a signed-out navigation (401 UNAUTHENTICATED or TOKEN_EXPIRED) gets 303 See Other to <APP_URL>/sign-in?next=/app/billing (Stage 9); other requests keep the JSON error.",
  })
  @ApiResponse({
    status: 303,
    description:
      "Browser navigation only: the link failed (Location <APP_URL>/app/billing?downloadError=<code>), or the browser is signed out (Location <APP_URL>/sign-in?next=/app/billing)",
  })
  @ApiZodQuery(InvoiceDownloadQuery)
  @ApiProduces("application/pdf")
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", UuidString) id: string,
    @ZodQuery(InvoiceDownloadQuery) query: DownloadQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!user.emailVerified) throw new AppError("EMAIL_NOT_VERIFIED");
    const file = await this.invoices.openDownload(
      user.id,
      id,
      query,
      AuditService.contextFrom(req),
    );
    res.setHeader("Cache-Control", "no-store");
    return new StreamableFile(file.stream, {
      type: "application/pdf",
      disposition: `attachment; filename="${file.fileName}"`,
      ...(file.bytes !== null ? { length: file.bytes } : {}),
    });
  }

  @Post("subscription/cancel")
  @RequirePermission("billing:manage")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Cancel at the end of the paid period (renewal stops now; the plan stays until the period ends)",
    description:
      "409 CONFLICT when not active or not yet linked to Paystack; 422 BILLING_NOT_CONFIGURED; 502 PAYMENT_PROVIDER_ERROR.",
  })
  @ApiZodBody(CancelSubscriptionRequest)
  @ApiZodResponse(200, SubscriptionView)
  cancel(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodBody(CancelBody) _body: CancelSubscriptionRequest,
    @Req() req: Request,
  ) {
    return this.billing.cancelAtPeriodEnd(
      org.organizationId,
      user.id,
      AuditService.contextFrom(req),
    );
  }

  @Post("subscription/resume")
  @RequirePermission("billing:manage")
  @PausedDuringDeletionGrace()
  @HttpCode(200)
  @ApiOperation({
    summary: "Turn renewal back on before the period ends",
    description: "409 CONFLICT when it can no longer be resumed.",
  })
  @ApiZodResponse(200, SubscriptionView)
  resume(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.billing.resume(org.organizationId, user.id, AuditService.contextFrom(req));
  }

  @Get("subscription/manage-link")
  @RequirePermission("billing:manage")
  @ApiOperation({
    summary: "Paystack's hosted page for updating the subscription's card (open in a new tab)",
  })
  @ApiZodResponse(200, SubscriptionManageLink)
  manageLink(@CurrentOrg() org: OrganizationScope) {
    return this.billing.manageLink(org.organizationId);
  }
}
