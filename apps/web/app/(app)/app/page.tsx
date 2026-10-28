"use client";

import type { BillingOverview, OverviewMetrics, OverviewPeriod } from "@leadforge/contracts";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Activity,
  BadgeCheck,
  Building2,
  ChevronRight,
  Compass,
  CreditCard,
  Database,
  FileUp,
  Mail,
  Plus,
  Receipt,
  Settings,
  Target,
  TriangleAlert,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Suspense } from "react";
import { useWorkspace } from "@/components/app/app-shell";
import {
  PipelineCard,
  QualitySection,
  RecentActivityCard,
  RecentJobsCard,
} from "@/components/app/overview/crm-cards";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Heading,
  HeadingLevel,
  JobStatus,
  PageHeader,
  Progress,
  SegmentedControl,
  Skeleton,
  Stagger,
  StaggerItem,
  Stat,
} from "@leadforge/ui";
import { apiFetch } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { subscriptionStatusMeta } from "@/lib/billing";
import { formatDate, formatDateTime, formatNumber, formatRelative, plural } from "@/lib/format";
import { useBillingOverview } from "@/lib/hooks/use-billing";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useUrlState } from "@/lib/hooks/use-url-state";
import { IMPORT_STATUS_LABELS, importJobState, jobState, sourceLabel } from "@/lib/labels";
import { queryKeys } from "@/lib/query-keys";

const PERIODS: { value: OverviewPeriod; label: string; long: string }[] = [
  { value: "7d", label: "7 days", long: "last 7 days" },
  { value: "30d", label: "30 days", long: "last 30 days" },
  { value: "90d", label: "90 days", long: "last 90 days" },
];

const parsePeriod = (p: URLSearchParams): OverviewPeriod => {
  const v = p.get("period");
  return v === "7d" || v === "90d" ? v : "30d";
};
const serializePeriod = (v: OverviewPeriod) =>
  new URLSearchParams(v === "30d" ? {} : { period: v });

/**
 * Discovery and credit metrics are reported only once their modules ship; until the API sends
 * them they stay "No data yet" rather than zero.
 */
type Metrics = Omit<OverviewMetrics, "discovery" | "credits"> &
  Partial<Pick<OverviewMetrics, "discovery" | "credits">>;

interface Tile {
  label: string;
  icon: LucideIcon;
  value: string | null;
  hint?: string;
  /** Its own request (the subscription comes from billing, not the overview). */
  loading?: boolean;
  href?: string;
}

/** The Subscription tile for owners and administrators, from GET /billing/overview. */
function subscriptionTile(b: BillingOverview | undefined, loading: boolean): Tile {
  const s = b?.subscription;
  if (!b) {
    return { label: "Subscription", icon: CreditCard, value: null, loading, href: "/app/billing" };
  }
  if (!s) {
    return {
      label: "Subscription",
      icon: CreditCard,
      value: "Free tier",
      hint: b.provider.configured ? "No paid plan" : "No paid plan · payments not set up yet",
      href: "/app/billing",
    };
  }
  const meta = subscriptionStatusMeta(s.status);
  const when =
    s.status === "past_due"
      ? "renewal payment overdue"
      : s.cancelAtPeriodEnd
        ? `ends ${formatDate(s.currentPeriodEnd)}`
        : s.renewsAt
          ? `renews ${formatDate(s.renewsAt)}`
          : null;
  return {
    label: "Subscription",
    icon: CreditCard,
    value: s.plan.name,
    hint: [meta.label, when].filter(Boolean).join(" · "),
    href: "/app/billing",
  };
}

function tiles(m: Metrics | undefined, periodLong: string, subscription: Tile | null): Tile[] {
  const c = m?.contacts;
  return [
    {
      label: "Businesses",
      icon: Building2,
      value: m ? formatNumber(m.businesses.total) : null,
      hint: m ? `${formatNumber(m.businesses.suppressed)} suppressed` : undefined,
    },
    {
      label: "Added in period",
      icon: Activity,
      value: m ? formatNumber(m.businesses.addedInPeriod) : null,
      hint: `Created in the ${periodLong}`,
    },
    {
      label: "Verified phones",
      icon: BadgeCheck,
      value: c ? formatNumber(c.verifiedPhone) : null,
      hint: c ? `of ${plural(c.withPhone, "business", "businesses")} with a phone` : undefined,
    },
    {
      label: "Verified emails",
      icon: Mail,
      value: c ? formatNumber(c.verifiedEmail) : null,
      hint: c ? `of ${plural(c.withEmail, "business", "businesses")} with an email` : undefined,
    },
    {
      label: "Qualified leads",
      icon: Target,
      value: m?.pipeline ? formatNumber(m.pipeline.qualifiedLeads) : null,
      hint: m?.pipeline
        ? `Open leads past the first stage, of ${formatNumber(m.pipeline.openLeads)} open`
        : undefined,
    },
    {
      label: "Active discovery jobs",
      icon: Workflow,
      value: m?.discovery ? formatNumber(m.discovery.inProgress) : null,
      hint: m?.discovery
        ? `${plural(m.discovery.total, "discovery job", "discovery jobs")} in total`
        : undefined,
    },
    {
      label: "Discovery jobs completed",
      icon: Compass,
      value: m?.discovery ? formatNumber(m.discovery.completedInPeriod) : null,
      hint: m?.discovery ? `Finished in the ${periodLong}` : undefined,
    },
    {
      label: "Failed jobs needing attention",
      icon: TriangleAlert,
      // Every job kind from Phase 5 (jobs.failedInPeriod); discovery only before that.
      value: m?.jobs
        ? formatNumber(m.jobs.failedInPeriod)
        : m?.discovery
          ? formatNumber(m.discovery.failedInPeriod)
          : null,
      hint: m?.jobs
        ? `Jobs of any kind that failed in the ${periodLong}`
        : m?.discovery
          ? `Failed in the ${periodLong}`
          : undefined,
    },
    {
      label: "Credits available",
      icon: Receipt,
      value: m?.credits ? formatNumber(m.credits.balance) : null,
      hint:
        m?.credits && m.credits.usedInPeriod !== undefined
          ? `${formatNumber(m.credits.usedInPeriod)} used in the ${periodLong}${m.credits.held > 0 ? ` · ${formatNumber(m.credits.held)} held` : ""}`
          : m?.credits && m.credits.held > 0
            ? `${formatNumber(m.credits.held)} held by running jobs`
            : undefined,
    },
    ...(subscription ? [subscription] : []),
  ];
}

function Meter({
  label,
  value,
  max,
  detail,
}: {
  label: string;
  value: number;
  max: number;
  detail: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Progress
        label={label}
        value={value}
        max={Math.max(max, 1)}
        valueText={max > 0 ? `${formatNumber(value)} of ${formatNumber(max)}` : "None yet"}
        showLabel
      />
      <p className="text-muted-foreground text-xs">{detail}</p>
    </div>
  );
}

function CoverageCard({ m }: { m: Metrics }) {
  const live = m.businesses.total - m.businesses.suppressed;
  const c = m.contacts;
  const rows = [
    { label: "With a phone", has: c.withPhone, verified: c.verifiedPhone },
    { label: "With an email", has: c.withEmail, verified: c.verifiedEmail },
    { label: "With a website", has: c.withWebsite, verified: c.verifiedWebsite },
  ];
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Contact coverage</CardTitle>
        <CardDescription>
          Businesses (not suppressed) with at least one value, and how many of those have a
          verified, fresh value.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-5">
        {rows.map((r) => (
          <Meter
            key={r.label}
            label={r.label}
            value={r.has}
            max={live}
            detail={`${formatNumber(r.verified)} verified · ${formatNumber(Math.max(live - r.has, 0))} missing`}
          />
        ))}
        <p className="text-muted-foreground text-xs">
          WhatsApp: {formatNumber(c.whatsappConfirmed)} confirmed by evidence,{" "}
          {formatNumber(c.whatsappUserAsserted)} asserted by your team.
        </p>
        <p className="text-muted-foreground border-border border-t pt-3 text-xs">
          From business records · stale after {m.freshnessDays} days · generated{" "}
          {formatDateTime(m.generatedAt)}
        </p>
      </CardContent>
    </Card>
  );
}

function SourcesCard({ m }: { m: Metrics }) {
  const live = m.businesses.total - m.businesses.suppressed;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Businesses by source</CardTitle>
        <CardDescription>A business can come from several sources.</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-5">
        {m.sources.length ? (
          m.sources.map((s) => (
            <Meter
              key={s.source}
              label={sourceLabel(s.source)}
              value={s.businesses}
              max={live}
              detail={`${plural(s.businesses, "business", "businesses")}`}
            />
          ))
        ) : (
          <p className="text-muted-foreground text-sm">No source has contributed a business yet.</p>
        )}
        <p className="text-muted-foreground border-border border-t pt-3 text-xs">
          <Link href="/app/sources" className="link-inline">
            Review sources
          </Link>{" "}
          · generated {formatRelative(m.generatedAt)}
        </p>
      </CardContent>
    </Card>
  );
}

function RecentImportsCard({ m, canImport }: { m: Metrics; canImport: boolean }) {
  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>Recent imports</CardTitle>
          <CardDescription>
            {plural(m.imports.total, "import", "imports")}
            {m.imports.inProgress ? `, ${formatNumber(m.imports.inProgress)} in progress` : ""}
          </CardDescription>
        </div>
        {canImport ? (
          <Button asChild variant="text" size="sm" className="shrink-0">
            <Link href="/app/businesses/import">Import CSV</Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {m.imports.recent.length ? (
          <ul className="divide-border flex min-w-0 flex-col divide-y">
            {m.imports.recent.map((i) => (
              <li key={i.id} className="flex min-w-0 flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                <Link
                  href={`/app/businesses/import?id=${i.id}`}
                  className="break-anywhere rounded-xs hover:text-primary text-sm font-medium hover:underline"
                >
                  {i.fileName}
                </Link>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <JobStatus
                    state={importJobState(i.status)}
                    label={IMPORT_STATUS_LABELS[i.status]}
                    size="sm"
                  />
                  <span className="text-muted-foreground text-xs">
                    {plural(i.rowCount, "row", "rows")} · {formatRelative(i.createdAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No CSV imports yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function RecentDiscoveryCard({ m, canRun }: { m: Metrics; canRun: boolean }) {
  const d = m.discovery;
  if (!d) return null;
  return (
    <Card className="h-full" data-testid="recent-discovery">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>Recent discovery jobs</CardTitle>
          <CardDescription>
            {plural(d.total, "job", "jobs")}
            {d.inProgress ? `, ${formatNumber(d.inProgress)} in progress` : ""}
          </CardDescription>
        </div>
        <Button asChild variant="text" size="sm" className="shrink-0">
          <Link href={canRun ? "/app/discovery/new" : "/app/discovery"}>
            {canRun ? "Create job" : "View all"}
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {d.recent.length ? (
          <ul className="divide-border flex min-w-0 flex-col divide-y">
            {d.recent.map((j) => (
              <li key={j.id} className="flex min-w-0 flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                <Link
                  href={`/app/discovery/${j.id}`}
                  className="break-anywhere rounded-xs hover:text-primary text-sm font-medium hover:underline"
                >
                  {j.name}
                </Link>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <JobStatus state={jobState(j.status)} size="sm" />
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatNumber(j.progress.created)} new · {formatNumber(j.progress.updated)}{" "}
                    updated · {formatRelative(j.createdAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No discovery jobs yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ChecklistLink({
  href,
  icon: Icon,
  title,
  body,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <li className="min-w-0">
      <Link href={href} className="state-layer flex min-w-0 items-start gap-4 px-5 py-3">
        <span className="bg-primary-container text-primary-container-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
          <Icon aria-hidden className="size-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-muted-foreground text-xs">{body}</span>
        </span>
        <ChevronRight aria-hidden className="text-muted-foreground mt-2.5 size-5 shrink-0" />
      </Link>
    </li>
  );
}

function GetStarted({ canImport, canRun }: { canImport: boolean; canRun: boolean }) {
  return (
    <Card className="flex h-full flex-col">
      <div className="flex flex-col gap-1 p-5 pb-3">
        <CardTitle className="leading-normal">Get started</CardTitle>
        <p className="text-muted-foreground text-sm">Set up the workspace for your team.</p>
      </div>
      <ul className="flex flex-col pb-2">
        {canRun ? (
          <ChecklistLink
            href="/app/discovery/new"
            icon={Compass}
            title="Create a discovery job"
            body="Find businesses in a category and a place. See the estimate before anything runs."
          />
        ) : null}
        {canImport ? (
          <>
            <ChecklistLink
              href="/app/businesses/import"
              icon={FileUp}
              title="Import businesses from a CSV"
              body="Map your columns, check the rows, then import with full provenance."
            />
            <ChecklistLink
              href="/app/businesses?add=1"
              icon={Plus}
              title="Add a business by hand"
              body="Phones, emails and websites are normalized and recorded as a manual source."
            />
          </>
        ) : null}
        <ChecklistLink
          href="/app/businesses"
          icon={Building2}
          title="Browse the directory"
          body="Search, filter by contact state, build lead lists and export with attribution."
        />
        <ChecklistLink
          href="/app/sources"
          icon={Database}
          title="Review data sources"
          body="What each source may store, for how long, and the attribution it needs."
        />
        <ChecklistLink
          href="/app/team"
          icon={Users}
          title="Invite your team"
          body="Add researchers, sales reps and analysts with the right role."
        />
        <ChecklistLink
          href="/app/settings"
          icon={Settings}
          title="Review organization settings"
          body="Country, currency and the freshness window for contact data."
        />
      </ul>
    </Card>
  );
}

function Overview() {
  const { org, me } = useWorkspace();
  const { can, canWriteBusinesses } = usePermissions();
  const canRun = can("discovery:run");
  const [period, setPeriod] = useUrlState(parsePeriod, serializePeriod);
  const periodLong = PERIODS.find((p) => p.value === period)?.long ?? "last 30 days";
  const firstName = me.user.name.trim().split(/\s+/)[0] ?? me.user.name;
  const overview = useQuery({
    queryKey: queryKeys.overview(org.id, period),
    queryFn: () => apiFetch<Metrics>(`/reports/overview?period=${period}`),
    placeholderData: (prev) => prev,
  });
  const m = overview.data;
  const empty = m !== undefined && m.businesses.total === 0;
  const canBilling = can("billing:manage");
  const billing = useBillingOverview(canBilling);
  const subscription = canBilling ? subscriptionTile(billing.data, billing.isPending) : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Overview"
        title={`Welcome, ${firstName}`}
        description={`${org.name} workspace. Metrics come from your workspace's records; anything a later release produces says "No data yet".`}
        actions={
          <SegmentedControl<OverviewPeriod>
            aria-label="Period"
            size="sm"
            value={period}
            onValueChange={(v) => setPeriod(v)}
            options={PERIODS.map((p) => ({
              value: p.value,
              ariaLabel: p.label,
              label: (
                <>
                  <span className="min-[400px]:hidden">{p.value}</span>
                  <span className="max-[399.98px]:hidden">{p.label}</span>
                </>
              ),
            }))}
          />
        }
      />

      <section aria-labelledby="metrics-title" className="flex flex-col gap-3">
        <Heading id="metrics-title" className="text-base font-medium">
          Workspace metrics
        </Heading>
        <HeadingLevel>
          {overview.isError && !m ? (
            <ErrorState
              title="Could not load metrics"
              message={friendlyMessage(overview.error)}
              requestId={requestIdOf(overview.error)}
              onRetry={() => void overview.refetch()}
            />
          ) : null}
          <Stagger
            distance={20}
            stagger={0.06}
            className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3"
          >
            {tiles(m, periodLong, subscription).map((t) => (
              <StaggerItem key={t.label} className="min-w-0">
                <Stat
                  label={t.label}
                  icon={t.icon}
                  value={t.value}
                  hint={t.value === null ? undefined : t.hint}
                  loading={t.loading ?? overview.isPending}
                  className="h-full"
                  footnote={
                    t.href && t.value !== null ? (
                      <Link href={t.href} className="link-inline">
                        Open billing
                      </Link>
                    ) : undefined
                  }
                  data-testid={t.label === "Subscription" ? "subscription-tile" : undefined}
                />
              </StaggerItem>
            ))}
          </Stagger>
          {m ? (
            <p className="text-muted-foreground text-xs">
              From your workspace&apos;s business records, discovery jobs and credit ledger ·
              contact counts exclude suppressed businesses · generated{" "}
              {formatRelative(m.generatedAt)}
            </p>
          ) : null}
        </HeadingLevel>
      </section>

      <Stagger
        distance={20}
        stagger={0.08}
        delay={0.2}
        className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2"
      >
        {overview.isPending ? (
          <StaggerItem className="min-w-0 xl:col-span-2">
            <Skeleton className="h-64 rounded-lg" />
          </StaggerItem>
        ) : empty ? (
          <StaggerItem className="min-w-0">
            <EmptyState
              className="h-full"
              icon={Building2}
              title="No businesses yet"
              description="Create a discovery job, import a CSV or add businesses by hand. Each value keeps its source, so you can always see where a contact detail came from."
              action={
                canWriteBusinesses ? (
                  <>
                    {canRun ? (
                      <Button asChild>
                        <Link href="/app/discovery/new">
                          <Compass aria-hidden /> Create discovery job
                        </Link>
                      </Button>
                    ) : null}
                    <Button asChild variant={canRun ? "outline" : "primary"}>
                      <Link href="/app/businesses/import">
                        <FileUp aria-hidden /> Import CSV
                      </Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/app/businesses?add=1">
                        <Plus aria-hidden /> Add business
                      </Link>
                    </Button>
                  </>
                ) : undefined
              }
            />
          </StaggerItem>
        ) : m ? (
          <>
            <StaggerItem className="min-w-0">
              <CoverageCard m={m} />
            </StaggerItem>
            <StaggerItem className="min-w-0">
              <SourcesCard m={m} />
            </StaggerItem>
          </>
        ) : null}
        {m?.pipeline && !empty ? (
          <StaggerItem className="min-w-0 self-start">
            <PipelineCard m={m} periodLong={periodLong} />
          </StaggerItem>
        ) : null}
        {m?.activity && !empty ? (
          <StaggerItem className="min-w-0 self-start">
            <RecentActivityCard m={m} periodLong={periodLong} />
          </StaggerItem>
        ) : null}
        {m?.jobs && (!empty || m.jobs.recent.length > 0) ? (
          <StaggerItem className="min-w-0 self-start">
            <RecentJobsCard m={m} periodLong={periodLong} />
          </StaggerItem>
        ) : null}
        {m?.discovery && (!empty || m.discovery.total > 0) ? (
          <StaggerItem className="min-w-0 self-start">
            <RecentDiscoveryCard m={m} canRun={canRun} />
          </StaggerItem>
        ) : null}
        {m && !empty ? (
          <StaggerItem className="min-w-0 self-start">
            <RecentImportsCard m={m} canImport={canWriteBusinesses} />
          </StaggerItem>
        ) : null}
        <StaggerItem className="min-w-0">
          <GetStarted canImport={canWriteBusinesses} canRun={canRun} />
        </StaggerItem>
      </Stagger>
      {m?.quality && !empty ? <QualitySection m={m} /> : null}
    </div>
  );
}

export default function OverviewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <Overview />
    </Suspense>
  );
}
