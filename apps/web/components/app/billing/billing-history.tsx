"use client";

import type { InvoiceView, PaymentView } from "@leadforge/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, FileText, ReceiptText, RotateCcw, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Banner,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Pagination,
  StatusIndicator,
} from "@leadforge/ui";
import { CellBox } from "@/components/app/businesses/shared";
import {
  UNDER_REVIEW_META,
  cardSummary,
  formatMoney,
  invoiceStatusMeta,
  paymentStatusMeta,
  purposeLabel,
  refundStatusMeta,
} from "@/lib/billing";
import { downloadErrorMessage } from "@/lib/exports";
import { friendlyMessage, isForbidden, requestIdOf } from "@/lib/errors";
import { formatDate, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import {
  useBillingInvoices,
  useBillingPayments,
  useInvoiceDownload,
} from "@/lib/hooks/use-billing";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { isApiError } from "@/lib/api";
import { RefundDialog } from "./refund-dialog";

const PAGE_SIZES = [25, 50, 100] as const;

/** Cursor stack for one list (resets to page one when the page size changes). */
function usePager(pageSize: number) {
  const viewKey = String(pageSize);
  const [pager, setPager] = useState<{ key: string; cursors: (string | null)[] }>({
    key: viewKey,
    cursors: [null],
  });
  const cursors = pager.key === viewKey ? pager.cursors : [null];
  return {
    cursors,
    cursor: cursors[cursors.length - 1] ?? null,
    next: (c: string) => setPager({ key: viewKey, cursors: [...cursors, c] }),
    previous: () => setPager({ key: viewKey, cursors: cursors.slice(0, -1) }),
  };
}

function PaymentStatusCell({ p }: { p: PaymentView }) {
  const meta = paymentStatusMeta(p.status);
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <StatusIndicator
        tone={meta.tone}
        size="sm"
        label={meta.label}
        title={meta.description}
        data-payment-status={p.status}
      />
      {p.underReview ? (
        <StatusIndicator
          tone={UNDER_REVIEW_META.tone}
          size="sm"
          label={UNDER_REVIEW_META.label}
          title={UNDER_REVIEW_META.description}
          data-testid="under-review"
        />
      ) : null}
      {p.refunds.map((r) => {
        const rm = refundStatusMeta(r.status);
        return (
          <span
            key={r.id}
            className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs"
          >
            <StatusIndicator tone={rm.tone} size="sm" label={rm.label} title={rm.description} />
            <span className="tabular-nums">{formatMoney(r.amountMinor, r.currency)}</span>
            {r.reversalUnits ? (
              <span>· {formatNumber(r.reversalUnits)} credits taken back</span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function PaymentActions({
  p,
  canRefund,
  onRefund,
}: {
  p: PaymentView;
  canRefund: boolean;
  onRefund: (p: PaymentView) => void;
}) {
  const refundable = canRefund && p.status === "success" && p.refundableMinor > 0 && !p.underReview;
  if (p.status === "pending") {
    return (
      <Button asChild size="sm" variant="text">
        <Link href={`/app/billing/return?reference=${encodeURIComponent(p.reference)}`}>
          <Search aria-hidden /> Check status
          <span className="sr-only"> of {p.description ?? "this payment"}</span>
        </Link>
      </Button>
    );
  }
  if (!refundable) return null;
  return (
    <Button size="sm" variant="outline" onClick={() => onRefund(p)} data-testid="refund-button">
      <RotateCcw aria-hidden /> Refund…
      <span className="sr-only"> {p.description ?? "this payment"}</span>
    </Button>
  );
}

/** Payments, newest first, with status, review flags, refunds and (for owners) Refund. */
export function PaymentsTab() {
  const { can } = usePermissions();
  const canRefund = can("billing:refund");
  const [pageSize, setPageSize] = useState<number>(25);
  const pager = usePager(pageSize);
  const payments = useBillingPayments({ pageSize, cursor: pager.cursor ?? undefined });
  const [refundFor, setRefundFor] = useState<PaymentView | null>(null);
  const rows = payments.data?.data ?? [];
  const error = payments.isError && !payments.data ? payments.error : null;

  const columns = useMemo<ColumnDef<PaymentView>[]>(
    () => [
      {
        id: "payment",
        header: "Payment",
        meta: { mobileTitle: true },
        cell: ({ row }) => {
          const p = row.original;
          return (
            <CellBox width="15rem" className="flex flex-col gap-0.5">
              <span className="font-medium">{p.description ?? purposeLabel(p.purpose)}</span>
              <span className="text-muted-foreground text-xs">
                {purposeLabel(p.purpose)}
                {cardSummary(p.card, p.channel) ? ` · ${cardSummary(p.card, p.channel)}` : ""}
              </span>
              <span className="text-muted-foreground break-anywhere font-mono text-[11px]">
                {p.reference}
              </span>
            </CellBox>
          );
        },
      },
      {
        id: "amount",
        header: "Amount",
        meta: { align: "end" },
        cell: ({ row }) => {
          const p = row.original;
          return (
            <CellBox width="8rem" className="flex flex-col items-end gap-0.5">
              <span className="font-medium">{formatMoney(p.amountMinor, p.currency)}</span>
              {p.refundedMinor > 0 ? (
                <span className="text-muted-foreground text-xs">
                  {formatMoney(p.refundedMinor, p.currency)} refunded
                </span>
              ) : null}
            </CellBox>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <CellBox width="11rem">
            <PaymentStatusCell p={row.original} />
          </CellBox>
        ),
      },
      {
        id: "credits",
        header: "Credits added",
        meta: { align: "end" },
        cell: ({ row }) =>
          row.original.creditsGranted !== null ? (
            formatNumber(row.original.creditsGranted)
          ) : (
            <span className="text-muted-foreground">None yet</span>
          ),
      },
      {
        id: "date",
        header: "Date",
        cell: ({ row }) => {
          const p = row.original;
          const at = p.paidAt ?? p.failedAt ?? p.initiatedAt;
          return (
            <CellBox width="9rem" className="flex flex-col gap-0.5">
              <time dateTime={at}>{formatDateTime(at)}</time>
              <span className="text-muted-foreground text-xs">{formatRelative(at)}</span>
            </CellBox>
          );
        },
      },
      {
        id: "actions",
        header: "Actions",
        meta: { mobileActions: true },
        cell: ({ row }) => (
          <PaymentActions p={row.original} canRefund={canRefund} onRefund={setRefundFor} />
        ),
      },
    ],
    [canRefund],
  );

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="payments-tab">
      {!canRefund ? (
        <p className="text-muted-foreground text-sm">
          Refunds are issued by owners of the workspace.
        </p>
      ) : null}
      <DataTable
        caption="Payments"
        columns={columns}
        data={rows}
        getRowId={(p) => p.id}
        loading={payments.isPending}
        skeletonRows={5}
        mobileCards
        error={
          error ? (
            <ErrorState
              title={
                isForbidden(error) ? "Your role cannot view payments" : "Could not load payments"
              }
              message={friendlyMessage(error)}
              requestId={requestIdOf(error)}
              onRetry={isForbidden(error) ? undefined : () => void payments.refetch()}
            />
          ) : undefined
        }
        empty={
          <EmptyState
            size="compact"
            icon={ReceiptText}
            title="No payments yet"
            description="Checkouts for plans and credit packs appear here with their status, the credits they added and any refunds."
          />
        }
        footer={
          error || (rows.length === 0 && pager.cursors.length === 1) ? null : (
            <Pagination
              hasPrevious={pager.cursors.length > 1}
              hasNext={Boolean(payments.data?.meta.nextCursor)}
              onPrevious={pager.previous}
              onNext={() => {
                const next = payments.data?.meta.nextCursor;
                if (next) pager.next(next);
              }}
              pageSize={pageSize}
              pageSizeOptions={[...PAGE_SIZES]}
              onPageSizeChange={setPageSize}
              pageCount={rows.length}
              loading={payments.isFetching && payments.isPlaceholderData}
              itemLabel="payments"
            />
          )
        }
      />
      {refundFor ? (
        <RefundDialog
          payment={refundFor}
          open={refundFor !== null}
          onOpenChange={(o) => !o && setRefundFor(null)}
        />
      ) : null}
    </div>
  );
}

/** Invoices, newest first, each with a PDF download through a fresh signed link. */
export function InvoicesTab({ navigate }: { navigate?: (url: string) => void }) {
  const [pageSize, setPageSize] = useState<number>(25);
  const pager = usePager(pageSize);
  const invoices = useBillingInvoices({ pageSize, cursor: pager.cursor ?? undefined });
  const download = useInvoiceDownload(navigate);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const rows = invoices.data?.data ?? [];
  const error = invoices.isError && !invoices.data ? invoices.error : null;
  const downloadCode = isApiError(download.error) ? download.error.code : null;
  const downloadProblem = downloadErrorMessage(downloadCode);

  const columns = useMemo<ColumnDef<InvoiceView>[]>(
    () => [
      {
        id: "number",
        header: "Invoice",
        meta: { mobileTitle: true },
        cell: ({ row }) => (
          <CellBox width="10rem" className="flex flex-col gap-0.5">
            <span className="font-mono text-[13px] font-medium">{row.original.number}</span>
            <span className="text-muted-foreground break-words text-xs">
              {row.original.lines[0]?.description ?? "Payment"}
              {row.original.lines.length > 1 ? ` and ${row.original.lines.length - 1} more` : ""}
            </span>
          </CellBox>
        ),
      },
      {
        id: "issued",
        header: "Issued",
        cell: ({ row }) => (
          <CellBox width="8rem">
            {row.original.issuedAt ? (
              <time dateTime={row.original.issuedAt}>{formatDate(row.original.issuedAt)}</time>
            ) : (
              "Not issued"
            )}
          </CellBox>
        ),
      },
      {
        id: "period",
        header: "Period",
        cell: ({ row }) =>
          row.original.periodStart && row.original.periodEnd ? (
            <CellBox width="11rem">
              {formatDate(row.original.periodStart)} to {formatDate(row.original.periodEnd)}
            </CellBox>
          ) : (
            <span className="text-muted-foreground">One-off</span>
          ),
      },
      {
        id: "total",
        header: "Total",
        meta: { align: "end" },
        cell: ({ row }) => (
          <span className="font-medium">
            {formatMoney(row.original.totalMinor, row.original.currency)}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const meta = invoiceStatusMeta(row.original.status);
          return (
            <StatusIndicator
              tone={meta.tone}
              size="sm"
              label={meta.label}
              title={meta.description}
            />
          );
        },
      },
      {
        id: "download",
        header: "Download",
        meta: { mobileActions: true },
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            loading={download.isPending && downloadingId === row.original.id}
            onClick={() => {
              setDownloadingId(row.original.id);
              download.mutate(row.original.id, { onSettled: () => setDownloadingId(null) });
            }}
            data-testid="invoice-download"
          >
            <Download aria-hidden /> PDF
            <span className="sr-only"> of invoice {row.original.number}</span>
          </Button>
        ),
      },
    ],
    [download, downloadingId],
  );

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="invoices-tab">
      {downloadProblem ? (
        <Banner
          tone="warning"
          title="The download did not start"
          description={downloadProblem}
          data-testid="download-problem"
        />
      ) : download.isError ? (
        <ErrorState
          title="Could not get a download link"
          message={friendlyMessage(download.error)}
          requestId={requestIdOf(download.error)}
        />
      ) : null}
      <DataTable
        caption="Invoices"
        columns={columns}
        data={rows}
        getRowId={(i) => i.id}
        loading={invoices.isPending}
        skeletonRows={4}
        mobileCards
        error={
          error ? (
            <ErrorState
              title={
                isForbidden(error) ? "Your role cannot view invoices" : "Could not load invoices"
              }
              message={friendlyMessage(error)}
              requestId={requestIdOf(error)}
              onRetry={isForbidden(error) ? undefined : () => void invoices.refetch()}
            />
          ) : undefined
        }
        empty={
          <EmptyState
            size="compact"
            icon={FileText}
            title="No invoices yet"
            description="An invoice with a sequential number is issued for every confirmed payment, as a PDF you can download here."
          />
        }
        footer={
          error || (rows.length === 0 && pager.cursors.length === 1) ? null : (
            <Pagination
              hasPrevious={pager.cursors.length > 1}
              hasNext={Boolean(invoices.data?.meta.nextCursor)}
              onPrevious={pager.previous}
              onNext={() => {
                const next = invoices.data?.meta.nextCursor;
                if (next) pager.next(next);
              }}
              pageSize={pageSize}
              pageSizeOptions={[...PAGE_SIZES]}
              onPageSizeChange={setPageSize}
              pageCount={rows.length}
              loading={invoices.isFetching && invoices.isPlaceholderData}
              itemLabel="invoices"
            />
          )
        }
      />
      <p className="text-muted-foreground text-xs">
        Each download uses a new link that works for 15 minutes, only for you, in this workspace.
      </p>
    </div>
  );
}
