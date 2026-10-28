"use client";

import {
  CreditLedgerQuery,
  LedgerEntryType,
  PAGE_SIZE_DEFAULT,
  type CreditLedgerEntry,
  type UsagePeriod,
} from "@leadforge/contracts";
import { Chart } from "@leadforge/ui/charts";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Coins,
  Compass,
  FileArchive,
  Globe,
  Hourglass,
  Lock,
  ReceiptText,
  SearchX,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  type ActiveFilter,
  Banner,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterMenu,
  Heading,
  HeadingLevel,
  MEDIA,
  PageHeader,
  Pagination,
  SegmentedControl,
  Stat,
  StatusIndicator,
  useMediaQuery,
} from "@leadforge/ui";
import { useUsageSummary } from "@/lib/hooks/use-reports";
import { formatDay } from "@/lib/reports";
import { BuyCreditsAction } from "@/components/app/billing/billing-shared";
import { CellBox } from "@/components/app/businesses/shared";
import { friendlyMessage, isForbidden, requestIdOf } from "@/lib/errors";
import { formatDateTime, formatNumber, formatRelative, plural } from "@/lib/format";
import { useCreditBalance, useCreditLedger } from "@/lib/hooks/use-credits";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useUrlState } from "@/lib/hooks/use-url-state";
import { LEDGER_ENTRY_META } from "@/lib/labels";

type EntryType = CreditLedgerEntry["entryType"];

interface LedgerState {
  entryType: EntryType[];
  referenceId?: string;
  pageSize: number;
  /** Usage chart period (GET /usage). Kept with the ledger filters so both share the URL. */
  period: UsagePeriod;
}

const USAGE_PERIODS: { value: UsagePeriod; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

const PAGE_SIZES = [25, 50, 100] as const;

export function parseLedgerParams(params: URLSearchParams): LedgerState {
  const raw: Record<string, unknown> = {};
  const types = params.getAll("entryType").filter(Boolean);
  if (types.length) raw.entryType = types;
  const ref = params.get("referenceId");
  if (ref) raw.referenceId = ref;
  const pageSize = params.get("pageSize");
  if (pageSize) raw.pageSize = pageSize;
  let parsed = CreditLedgerQuery.safeParse(raw);
  for (let i = 0; !parsed.success && i < 5; i++) {
    for (const issue of parsed.error.issues) delete raw[String(issue.path[0])];
    parsed = CreditLedgerQuery.safeParse(raw);
  }
  const q = parsed.success
    ? parsed.data
    : { entryType: [], referenceId: undefined, pageSize: PAGE_SIZE_DEFAULT };
  const period = params.get("period");
  return {
    entryType: q.entryType ?? [],
    referenceId: q.referenceId,
    pageSize: PAGE_SIZES.includes(q.pageSize as 25) ? q.pageSize : PAGE_SIZE_DEFAULT,
    period: period === "7d" || period === "90d" ? period : "30d",
  };
}

export function serializeLedgerState(state: LedgerState): URLSearchParams {
  const out = new URLSearchParams();
  if (state.period !== "30d") out.set("period", state.period);
  for (const t of state.entryType) out.append("entryType", t);
  if (state.referenceId) out.set("referenceId", state.referenceId);
  if (state.pageSize !== PAGE_SIZE_DEFAULT) out.set("pageSize", String(state.pageSize));
  return out;
}

/** Signed change to the balance; a capture moves nothing (the hold already did) and says so. */
export function ledgerAmount(entry: CreditLedgerEntry): { text: string; detail: string | null } {
  if (entry.entryType === "capture") {
    return {
      text: "0",
      detail: `${formatNumber(entry.capturedUnits ?? 0)} charged from the hold`,
    };
  }
  const sign = entry.units > 0 ? "+" : entry.units < 0 ? "−" : "";
  return { text: `${sign}${formatNumber(Math.abs(entry.units))}`, detail: null };
}

/**
 * What an entry belongs to, by name (`referenceName`, Phase 5: the job name, "Website analysis:
 * <host>", a credit pack) with a link to its page where one exists. Entries written before Phase 5
 * have no name and fall back to the kind of reference.
 */
function Reference({ entry }: { entry: CreditLedgerEntry }) {
  const { can } = usePermissions();
  const canBilling = can("billing:manage");
  const name = entry.referenceName ?? null;
  if (!entry.referenceId) {
    return name ? (
      <span className="break-words">{name}</span>
    ) : (
      <span className="text-muted-foreground">None</span>
    );
  }
  if (entry.referenceType === "website_analysis" && /^[a-f0-9]{24}$/i.test(entry.referenceId)) {
    return (
      <Link
        href={`/app/analysis/${entry.referenceId}`}
        className="text-primary rounded-xs break-anywhere hover:underline"
      >
        {name ?? `Website analysis …${entry.referenceId.slice(-6)}`}
      </Link>
    );
  }
  if (entry.referenceType === "payment" || entry.referenceType === "refund") {
    const label = name ?? (entry.referenceType === "payment" ? "Payment" : "Refund");
    return canBilling ? (
      <Link
        href="/app/billing?tab=payments"
        className="text-primary rounded-xs break-words hover:underline"
      >
        {label}
      </Link>
    ) : (
      <span className="break-words">{label}</span>
    );
  }
  if (entry.referenceType === "discovery_job" && /^[a-f0-9]{24}$/i.test(entry.referenceId)) {
    return (
      <Link
        href={`/app/discovery/${entry.referenceId}`}
        className="text-primary rounded-xs break-words hover:underline"
      >
        {name ?? "Discovery job"}
      </Link>
    );
  }
  return (
    <span className="break-anywhere text-xs">
      {name ?? `${entry.referenceType ?? "Reference"} ${entry.referenceId}`}
    </span>
  );
}

const COLUMNS: ColumnDef<CreditLedgerEntry>[] = [
  {
    id: "entry",
    header: "Entry",
    meta: { mobileTitle: true },
    cell: ({ row }) => {
      const meta = LEDGER_ENTRY_META[row.original.entryType];
      return (
        <CellBox width="16rem" className="flex flex-col gap-0.5">
          <StatusIndicator
            tone={meta?.tone ?? "neutral"}
            size="sm"
            label={meta?.label ?? row.original.entryType}
            title={meta?.description}
            data-entry-type={row.original.entryType}
          />
          {row.original.description ? (
            <span className="text-muted-foreground break-words text-xs">
              {row.original.description}
            </span>
          ) : null}
        </CellBox>
      );
    },
  },
  {
    id: "amount",
    header: "Change",
    meta: { align: "end" },
    cell: ({ row }) => {
      const a = ledgerAmount(row.original);
      return (
        <CellBox width="9rem" className="flex flex-col items-end gap-0.5">
          <span className="font-medium">{a.text}</span>
          {a.detail ? <span className="text-muted-foreground text-xs">{a.detail}</span> : null}
        </CellBox>
      );
    },
  },
  {
    id: "balanceAfter",
    header: "Balance after",
    meta: { align: "end" },
    cell: ({ row }) => formatNumber(row.original.balanceAfter),
  },
  {
    id: "reference",
    header: "Reference",
    cell: ({ row }) => (
      <CellBox width="9rem">
        <Reference entry={row.original} />
      </CellBox>
    ),
  },
  {
    id: "time",
    header: "Time",
    cell: ({ row }) => (
      <CellBox width="10rem" className="flex flex-col gap-0.5">
        <time dateTime={row.original.createdAt}>{formatDateTime(row.original.createdAt)}</time>
        <span className="text-muted-foreground text-xs">
          {formatRelative(row.original.createdAt)}
        </span>
      </CellBox>
    ),
  },
];

function LedgerCard({ entry }: { entry: CreditLedgerEntry }) {
  const meta = LEDGER_ENTRY_META[entry.entryType];
  const a = ledgerAmount(entry);
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-[13px]">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <StatusIndicator
          tone={meta?.tone ?? "neutral"}
          size="sm"
          label={meta?.label ?? entry.entryType}
        />
        <span className="shrink-0 font-medium tabular-nums">{a.text}</span>
      </div>
      {a.detail ? <span className="text-muted-foreground text-xs">{a.detail}</span> : null}
      {entry.description ? (
        <span className="text-muted-foreground break-anywhere text-xs">{entry.description}</span>
      ) : null}
      <span className="text-xs tabular-nums">Balance after {formatNumber(entry.balanceAfter)}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
        {entry.referenceId ? (
          <>
            <Reference entry={entry} />
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
          </>
        ) : null}
        <span className="text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
      </span>
    </div>
  );
}

function Ledger({
  state,
  setState,
}: {
  state: LedgerState;
  setState: (next: LedgerState) => void;
}) {
  const compact = useMediaQuery(MEDIA.belowMd);
  const viewKey = JSON.stringify({ ...state, period: undefined });
  const [pager, setPager] = useState<{ key: string; cursors: (string | null)[] }>({
    key: viewKey,
    cursors: [null],
  });
  const cursors = pager.key === viewKey ? pager.cursors : [null];
  const cursor = cursors[cursors.length - 1] ?? null;
  const ledger = useCreditLedger({
    entryType: state.entryType.length ? state.entryType : undefined,
    referenceId: state.referenceId,
    pageSize: state.pageSize,
    cursor: cursor ?? undefined,
  });
  const rows = ledger.data?.data ?? [];
  const set = (next: Partial<LedgerState>) => setState({ ...state, ...next });
  const filtered = state.entryType.length > 0 || Boolean(state.referenceId);
  const error = ledger.isError && !ledger.data ? ledger.error : null;

  const applied: ActiveFilter[] = [
    ...state.entryType.map((t) => ({
      id: `type-${t}`,
      label: `Entry: ${LEDGER_ENTRY_META[t].label}`,
      onRemove: () => set({ entryType: state.entryType.filter((x) => x !== t) }),
    })),
    ...(state.referenceId
      ? [
          {
            id: "reference",
            label: `Job: ${state.referenceId.slice(-8)}`,
            onRemove: () => set({ referenceId: undefined }),
          },
        ]
      : []),
  ];

  return (
    <section aria-labelledby="ledger-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <Heading id="ledger-title" className="text-base font-medium">
          Credit ledger
        </Heading>
        <p className="text-muted-foreground text-sm">
          Every change to the balance, newest first. A job holds credits when it is queued, then the
          records it produced are charged and the rest is released.
        </p>
      </div>
      <HeadingLevel>
        <DataTable
          caption="Credit ledger"
          columns={COLUMNS}
          data={rows}
          getRowId={(r) => r.id}
          loading={ledger.isPending}
          skeletonRows={6}
          error={
            error ? (
              <ErrorState
                title={
                  isForbidden(error)
                    ? "Your role cannot view the ledger"
                    : "Could not load the ledger"
                }
                message={friendlyMessage(error)}
                requestId={requestIdOf(error)}
                onRetry={isForbidden(error) ? undefined : () => void ledger.refetch()}
              />
            ) : undefined
          }
          empty={
            filtered ? (
              <EmptyState
                size="compact"
                icon={SearchX}
                title="No entries match"
                action={
                  <Button
                    variant="outline"
                    onClick={() => set({ entryType: [], referenceId: undefined })}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                size="compact"
                icon={ReceiptText}
                title="No credit activity yet"
                description="Grants, purchases and the holds, charges and releases of discovery jobs appear here."
              />
            )
          }
          mobileCards={{ render: (row) => <LedgerCard entry={row} /> }}
          toolbar={
            <FilterBar
              filters={applied}
              onClearAll={
                applied.length ? () => set({ entryType: [], referenceId: undefined }) : undefined
              }
              sheetTitle="Filter the ledger"
            >
              <FilterMenu
                label="Entry type"
                appearance={compact ? "field" : "chip"}
                sections={[
                  {
                    id: "entryType",
                    type: "multiple",
                    options: LedgerEntryType.options.map((t) => ({
                      value: t,
                      label: LEDGER_ENTRY_META[t].label,
                    })),
                    value: state.entryType,
                    onValueChange: (v) => set({ entryType: v as EntryType[] }),
                  },
                ]}
              />
            </FilterBar>
          }
          footer={
            error || (rows.length === 0 && cursors.length === 1) ? null : (
              <Pagination
                hasPrevious={cursors.length > 1}
                hasNext={Boolean(ledger.data?.meta.nextCursor)}
                onPrevious={() => setPager({ key: viewKey, cursors: cursors.slice(0, -1) })}
                onNext={() => {
                  const next = ledger.data?.meta.nextCursor;
                  if (next) setPager({ key: viewKey, cursors: [...cursors, next] });
                }}
                pageSize={state.pageSize}
                pageSizeOptions={[...PAGE_SIZES]}
                onPageSizeChange={(pageSize) => set({ pageSize })}
                pageCount={rows.length}
                loading={ledger.isFetching && ledger.isPlaceholderData}
                itemLabel="entries"
              />
            )
          }
        />
      </HeadingLevel>
    </section>
  );
}

/**
 * Daily usage from the rollup (GET /usage?period): totals per metric and two charts, credits used
 * per day and work done per day (separate charts, because credits and job counts are different
 * units). The rollup runs every 10 minutes; the ledger below has the per-job detail.
 */
function UsageOverTime({
  period,
  onPeriodChange,
}: {
  period: UsagePeriod;
  onPeriodChange: (p: UsagePeriod) => void;
}) {
  const usage = useUsageSummary(period);
  const u = usage.data;
  const t = u?.totals;
  const rows = (u?.series ?? []).map((s) => ({ day: s.day, ...s.values }));
  const hasCredits = Boolean(t && t.credits_used > 0);
  const hasWork = Boolean(t && t.discovery_jobs + t.analyses + t.enrichment_runs + t.exports > 0);
  const footnote = u
    ? `${u.from} to ${u.to} (UTC days) · ${u.computedAt ? `rolled up ${formatRelative(u.computedAt)}` : "not rolled up yet; figures appear within 10 minutes"}`
    : undefined;

  return (
    <section
      aria-labelledby="usage-title"
      className="flex min-w-0 flex-col gap-3"
      data-testid="usage-over-time"
    >
      <div className="flex min-w-0 flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <Heading id="usage-title" className="text-base font-medium">
            Usage over time
          </Heading>
          <p className="text-muted-foreground text-sm">
            Daily totals for this workspace, from the usage rollup.
          </p>
        </div>
        <SegmentedControl<UsagePeriod>
          aria-label="Usage period"
          size="sm"
          value={period}
          onValueChange={onPeriodChange}
          options={USAGE_PERIODS.map((p) => ({ value: p.value, label: p.label }))}
          className="shrink-0 self-start"
        />
      </div>
      <HeadingLevel>
        {usage.isError && !u ? (
          <ErrorState
            title="Could not load usage"
            message={friendlyMessage(usage.error)}
            requestId={requestIdOf(usage.error)}
            onRetry={() => void usage.refetch()}
          />
        ) : (
          <>
            <div
              className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4"
              data-testid="usage-totals"
            >
              <Stat
                label="Credits used"
                icon={Coins}
                value={t ? formatNumber(t.credits_used) : null}
                hint="Captured from holds"
                loading={usage.isPending}
              />
              <Stat
                label="Discovery records"
                icon={Compass}
                value={t ? formatNumber(t.discovery_records) : null}
                hint={
                  t
                    ? `${plural(t.discovery_jobs, "discovery job", "discovery jobs")} created`
                    : undefined
                }
                loading={usage.isPending}
              />
              <Stat
                label="Website analyses"
                icon={Globe}
                value={t ? formatNumber(t.analyses) : null}
                hint={
                  t
                    ? `${plural(t.enrichment_runs, "contact or email check", "contact and email checks")} (free)`
                    : undefined
                }
                loading={usage.isPending}
              />
              <Stat
                label="Exports"
                icon={FileArchive}
                value={t ? formatNumber(t.exports) : null}
                hint={t ? `${plural(t.export_rows, "row", "rows")} exported` : undefined}
                loading={usage.isPending}
              />
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
              <Chart
                type="bar"
                title="Credits used per day"
                data={hasCredits ? rows : []}
                xKey="day"
                xLabel="Day (UTC)"
                xFormatter={formatDay}
                series={[{ key: "credits_used", label: "Credits used" }]}
                loading={usage.isPending}
                emptyMessage="No credits were used in this period."
                footnote={footnote}
              />
              <Chart
                type="bar"
                stacked
                title="Work done per day"
                data={hasWork ? rows : []}
                xKey="day"
                xLabel="Day (UTC)"
                xFormatter={formatDay}
                series={[
                  { key: "discovery_jobs", label: "Discovery jobs", slot: 1 },
                  { key: "analyses", label: "Website analyses", slot: 3 },
                  { key: "enrichment_runs", label: "Contact and email checks", slot: 4 },
                  { key: "exports", label: "Exports", slot: 5 },
                ]}
                loading={usage.isPending}
                emptyMessage="No jobs or exports in this period."
                footnote={footnote}
              />
            </div>
          </>
        )}
      </HeadingLevel>
    </section>
  );
}

/**
 * Usage and credits (/app/usage): the balance from the PostgreSQL ledger, credits held by
 * running jobs, how charging works and the ledger itself (not for sales reps). Owners and
 * administrators buy credits on the Billing page.
 */
export function UsagePage() {
  const { can } = usePermissions();
  const balance = useCreditBalance();
  const b = balance.data;
  const [state, setState] = useUrlState(parseLedgerParams, serializeLedgerState);

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <PageHeader
        eyebrow="Account"
        title="Usage and credits"
        description="Credits pay for discovery: 1 credit for each business record a job produces. The balance comes from the workspace ledger, never from the browser."
        actions={<BuyCreditsAction variant="primary" size="md" />}
      />

      <section aria-labelledby="balance-title" className="flex min-w-0 flex-col gap-3">
        <Heading id="balance-title" className="sr-only">
          Balance
        </Heading>
        <HeadingLevel>
          {balance.isError && !b ? (
            <ErrorState
              title="Could not load the credit balance"
              message={friendlyMessage(balance.error)}
              requestId={requestIdOf(balance.error)}
              onRetry={() => void balance.refetch()}
            />
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
              <Stat
                label="Available now"
                icon={Wallet}
                value={b ? formatNumber(b.balance) : null}
                hint="Credits a new job can hold"
                loading={balance.isPending}
                data-testid="credits-available"
              />
              <Stat
                label="Held by running jobs"
                icon={Lock}
                value={b ? formatNumber(b.held) : null}
                hint={b ? plural(b.openHolds, "open hold", "open holds") : undefined}
                loading={balance.isPending}
              />
              <Stat
                label="Last ledger change"
                icon={Hourglass}
                value={b ? formatRelative(b.updatedAt) : null}
                hint={b ? formatDateTime(b.updatedAt) : undefined}
                loading={balance.isPending}
              />
            </div>
          )}
          {b ? (
            <p className="text-muted-foreground text-xs">
              From the workspace credit ledger · loaded{" "}
              {formatRelative(new Date(balance.dataUpdatedAt).toISOString())}
            </p>
          ) : null}
        </HeadingLevel>
      </section>

      <Card variant="filled">
        <CardHeader>
          <CardTitle>How credits are charged</CardTitle>
          <CardDescription>From the LeadForge charging rules.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex min-w-0 list-disc flex-col gap-1.5 pl-5 text-sm">
            <li>
              A discovery job holds its record limit (capped by what its sources can return) when it
              is queued.
            </li>
            <li>
              When it finishes, 1 credit is charged per record produced: a new business, or an
              existing one that gained new details. The rest of the hold is released.
            </li>
            <li>
              Duplicates, skipped places and items that failed on our side are never charged. A
              cancelled or failed job is charged only for what it produced.
            </li>
            <li>CSV imports and CSV exports do not use credits.</li>
          </ul>
        </CardContent>
      </Card>

      {can("usage:read") ? (
        <>
          <UsageOverTime
            period={state.period}
            onPeriodChange={(period) => setState({ ...state, period })}
          />
          <Ledger state={state} setState={setState} />
        </>
      ) : (
        <Banner
          tone="info"
          title="The ledger is not available to your role"
          description="Sales representatives can see the balance. Owners, administrators, researchers and analysts can see every ledger entry."
        />
      )}
    </div>
  );
}
