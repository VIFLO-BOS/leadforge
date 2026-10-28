import type { Readable } from "node:stream";
import { Inject, Injectable } from "@nestjs/common";
import {
  ROLE_PERMISSIONS,
  type InvoiceDownloadLink,
  type InvoiceDownloadQuery,
  type InvoiceLine,
  type InvoiceView,
  type ServerEnv,
} from "@leadforge/contracts";
import type { Invoice, Payment } from "@leadforge/db-postgres";
import { ENV } from "../config/env.module.js";
import { AppError } from "../common/errors/app.error.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { DownloadSigner } from "../storage/download-signer.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/object-storage.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import { minorToNumber } from "./money.js";
import { BillingRepository } from "./repositories/billing.repository.js";

type InvoiceWithPayments = Invoice & { payments: Payment[] };

interface StoredLine {
  description: string;
  quantity: number;
  unitMinor: string;
  amountMinor: string;
}

export function storedLines(lines: unknown): StoredLine[] {
  return Array.isArray(lines)
    ? (lines as StoredLine[]).filter((l) => l && typeof l.description === "string")
    : [];
}

export function toInvoiceView(inv: InvoiceWithPayments): InvoiceView {
  const lines: InvoiceLine[] = storedLines(inv.lines).map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unitMinor: minorToNumber(BigInt(l.unitMinor)),
    amountMinor: minorToNumber(BigInt(l.amountMinor)),
  }));
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    lines,
    subtotalMinor: minorToNumber(inv.subtotalMinor),
    taxMinor: minorToNumber(inv.taxMinor),
    totalMinor: minorToNumber(inv.totalMinor),
    currency: inv.currency,
    issuedAt: inv.issuedAt?.toISOString() ?? null,
    paidAt: inv.paidAt?.toISOString() ?? null,
    periodStart: inv.periodStart?.toISOString() ?? null,
    periodEnd: inv.periodEnd?.toISOString() ?? null,
    paymentReference: inv.payments[0]?.providerReference ?? null,
    subscriptionId: inv.subscriptionId,
    pdfReady: Boolean(inv.pdfKey),
  };
}

/** Download-link claims: invoices share the export signer with an `invoice:` namespace. */
const claimId = (invoiceId: string) => `invoice:${invoiceId}`;

/**
 * Invoice PDFs: rendered from the stored invoice (pdfkit), kept in object storage under
 * `invoices/<organizationId>/<invoiceId>.pdf` (statutory records: not cleaned up with exports),
 * downloaded through short-lived HMAC links bound to the organization, invoice and user, exactly
 * like export downloads.
 */
@Injectable()
export class InvoiceService {
  constructor(
    private readonly repo: BillingRepository,
    private readonly signer: DownloadSigner,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly organizations: OrganizationsService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  static storageKey(organizationId: string, invoiceId: string): string {
    return `invoices/${organizationId}/${invoiceId}.pdf`;
  }

  async render(inv: InvoiceWithPayments): Promise<Buffer> {
    const billTo = (inv.billTo ?? {}) as {
      organizationName?: string;
      email?: string;
      country?: string | null;
      testMode?: boolean;
    };
    const payment = inv.payments[0] ?? null;
    const card = (payment?.authorizationMasked ?? null) as {
      brand?: string | null;
      last4?: string | null;
    } | null;
    const method = card?.last4
      ? `${card.brand ?? "card"} ending ${card.last4}`
      : (payment?.channel ?? null);
    return renderInvoicePdf({
      number: inv.number,
      status: inv.status,
      issuedAt: inv.issuedAt,
      paidAt: inv.paidAt,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      currency: inv.currency,
      lines: storedLines(inv.lines).map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitMinor: BigInt(l.unitMinor),
        amountMinor: BigInt(l.amountMinor),
      })),
      subtotalMinor: inv.subtotalMinor,
      taxMinor: inv.taxMinor,
      totalMinor: inv.totalMinor,
      billTo: {
        organizationName: billTo.organizationName ?? "",
        email: billTo.email ?? "",
        country: billTo.country ?? null,
      },
      payment: payment ? { reference: payment.providerReference, method } : null,
      testMode: billTo.testMode === true,
    });
  }

  /** Renders and stores the PDF once (worker job `generate-invoice-pdf`, or the first download). */
  async ensurePdf(
    organizationId: string,
    invoiceId: string,
  ): Promise<{ key: string; generated: boolean }> {
    const inv = await this.repo.invoiceByIdAny(invoiceId);
    if (!inv || inv.billingCustomer.organizationId !== organizationId)
      throw AppError.notFound("Invoice");
    if (
      inv.pdfKey &&
      (await this.storage.get(inv.pdfKey).then((o) => (o ? (o.stream.destroy(), true) : false)))
    ) {
      return { key: inv.pdfKey, generated: false };
    }
    const pdf = await this.render(inv);
    const key = InvoiceService.storageKey(organizationId, inv.id);
    await this.storage.put(key, pdf, "application/pdf");
    await this.repo.setInvoicePdf(inv.id, key);
    return { key, generated: true };
  }

  private apiOrigin(): string {
    try {
      return new URL(this.env.API_URL).origin;
    } catch {
      return "";
    }
  }

  async downloadLink(
    organizationId: string,
    customerId: string,
    userId: string,
    invoiceId: string,
    now: Date = new Date(),
  ): Promise<InvoiceDownloadLink> {
    const inv = await this.repo.invoiceById(customerId, invoiceId);
    if (!inv) throw AppError.notFound("Invoice");
    const expires = Math.floor(now.getTime() / 1000) + this.env.EXPORT_DOWNLOAD_URL_TTL_SECONDS;
    const sig = this.signer.sign({ organizationId, exportId: claimId(inv.id), userId, expires });
    const query = new URLSearchParams({ org: organizationId, expires: String(expires), sig });
    return {
      url: `${this.apiOrigin()}/api/v1/billing/invoices/${inv.id}/download?${query.toString()}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  /**
   * Checks a signed link for the signed-in user (signature, expiry, then current membership and
   * billing permission), renders the PDF if it is not stored yet, and opens it. Audited.
   */
  async openDownload(
    userId: string,
    invoiceId: string,
    query: InvoiceDownloadQuery,
    ctx: AuditContext,
  ): Promise<{ stream: Readable; bytes: number | null; fileName: string }> {
    const check = this.signer.verify(
      { organizationId: query.org, exportId: claimId(invoiceId), userId, expires: query.expires },
      query.sig,
    );
    if (!check.ok && check.reason === "invalid")
      throw new AppError(
        "DOWNLOAD_LINK_INVALID",
        "This download link is not valid for you. Request a new link from the Billing page.",
      );
    if (!check.ok)
      throw new AppError(
        "DOWNLOAD_LINK_EXPIRED",
        "This download link has expired. Request a new link from the Billing page.",
      );
    const member = await this.organizations.isActiveMember(query.org, userId);
    if (!member.active || !member.role) throw new AppError("ORG_FORBIDDEN");
    if (!ROLE_PERMISSIONS[member.role].includes("billing:manage")) throw AppError.forbidden();
    const { key } = await this.ensurePdf(query.org, invoiceId);
    const object = await this.storage.get(key);
    if (!object) throw new AppError("INTERNAL_ERROR", "The invoice file could not be read");
    const inv = await this.repo.invoiceByIdAny(invoiceId);
    await this.audit.record(
      {
        organizationId: query.org,
        actorUserId: userId,
        actorType: "user",
        action: "billing.invoice_downloaded",
        resourceType: "invoice",
        resourceId: invoiceId,
        after: { number: inv?.number ?? null },
      },
      ctx,
    );
    return {
      stream: object.stream,
      bytes: object.bytes,
      fileName: `${inv?.number ?? "invoice"}.pdf`,
    };
  }
}
