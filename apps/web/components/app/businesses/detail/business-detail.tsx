"use client";

import { EXPIRED_NAME_LABEL, type BusinessDetail as Detail } from "@leadforge/contracts";
import {
  ArrowLeft,
  Copy,
  Download,
  EllipsisVertical,
  EyeOff,
  Eye,
  ListPlus,
  MessageSquarePlus,
  Pencil,
  SearchX,
  TimerOff,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  Badge,
  Banner,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  CopyableValue,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  FieldStatus,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@leadforge/ui";
import { isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatDate, formatDateTime, formatRelative, plural } from "@/lib/format";
import { useBusinessDetail, useUnsuppressBusiness } from "@/lib/hooks/use-businesses";
import { useLeadLists } from "@/lib/hooks/use-lists";
import { isRunActive, useCheckEmail, useEnrichmentRuns } from "@/lib/hooks/use-enrichment";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useUrlState } from "@/lib/hooks/use-url-state";
import { licenseAnchor } from "@/lib/data-licenses";
import { sourceLabel } from "@/lib/labels";
import { WhatsAppIndicator, fullLocation, renderBreadcrumbLink } from "../shared";
import { ActivityFeed } from "@/components/app/crm/activity-feed";
import { BusinessListsCard } from "@/components/app/crm/business-lists-card";
import { LeadPanel } from "@/components/app/crm/lead-panel";
import { AddToListDialog } from "@/components/app/crm/list-picker";
import { LogActivityDialog, type ActivityTarget } from "@/components/app/crm/log-activity-dialog";
import { OutreachPanel } from "@/components/app/crm/outreach-parts";
import { ExportDialog } from "@/components/app/exports/export-dialog";
import { AnalysisTab, OpportunitiesTab, analysisBlocker } from "./analysis-tab";
import {
  ContactsPanel,
  LocationPanel,
  PanelFootnote,
  sourcesFor,
  type ContactActions,
} from "./contacts-panel";
import { DuplicatesTab } from "./duplicates-tab";
import { ContactCollectionCard, RefreshDialog, enrichmentRequestError } from "./enrichment-panel";
import { ScoreTab } from "./score-tab";
import { CorrectionDialog, type CorrectionTarget } from "./correction-dialog";
import { ProvenancePanel, VerificationPanel } from "./provenance-panel";
import { SuppressDialog } from "./suppress-dialog";

const TABS = [
  "overview",
  "provenance",
  "verification",
  "analysis",
  "score",
  "opportunities",
  "duplicates",
  "activities",
] as const;
type Tab = (typeof TABS)[number];

const parseTab = (params: URLSearchParams): Tab => {
  const t = params.get("tab");
  return TABS.includes(t as Tab) ? (t as Tab) : "overview";
};
const serializeTab = (tab: Tab) => new URLSearchParams(tab === "overview" ? {} : { tab });

const CREATED_VIA: Record<Detail["createdVia"]["kind"], string> = {
  import: "CSV import",
  manual: "Added by a team member",
  discovery: "Discovery job",
  seed: "Development sample data",
};

function isNotFound(err: unknown): boolean {
  return isApiError(err) && (err.status === 404 || err.code === "VALIDATION_FAILED");
}

export function DetailSkeleton() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-busy="true"
      aria-label="Loading business"
    >
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-12 w-full rounded-none" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Skeleton className="h-96 rounded-lg" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    </div>
  );
}

/**
 * Business detail (/app/businesses/[id]): overview header, contacts with field states,
 * provenance, verification history, corrections and suppression. Later-phase sections are
 * disabled tabs. Unknown ids and other organizations' ids render a not-found state.
 */
export function BusinessDetail({ id }: { id: string }) {
  const detail = useBusinessDetail(id);

  if (detail.isPending) return <DetailSkeleton />;

  if (detail.isError) {
    if (isNotFound(detail.error)) {
      return (
        <div className="flex flex-col gap-6">
          <Breadcrumbs
            items={[{ label: "Businesses", href: "/app/businesses" }, { label: "Not found" }]}
            renderLink={renderBreadcrumbLink}
          />
          <PageHeader title="Business not found" />
          <EmptyState
            icon={SearchX}
            title="We could not find this business"
            description="It may have been removed, the link may be wrong, or it belongs to another workspace. Switch workspace from the top bar if you expected to see it."
            action={
              <Button asChild>
                <Link href="/app/businesses">
                  <ArrowLeft aria-hidden /> Back to businesses
                </Link>
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Business" />
        <ErrorState
          title="Could not load this business"
          message={friendlyMessage(detail.error)}
          requestId={requestIdOf(detail.error)}
          onRetry={() => void detail.refetch()}
        />
      </div>
    );
  }

  return <DetailView detail={detail.data} />;
}

/** Name, suppression and contacts on record, for the log-activity dialog. */
export function activityTargetOf(detail: Detail): ActivityTarget {
  return {
    id: detail.id,
    name: detail.name.value ?? EXPIRED_NAME_LABEL,
    suppressed: detail.suppression.suppressed,
    phones: detail.phones
      .map((p) => p.international ?? p.e164 ?? p.value)
      .filter((v): v is string => Boolean(v)),
    emails: detail.emails.map((e) => e.address ?? e.value).filter((v): v is string => Boolean(v)),
  };
}

function DetailView({ detail }: { detail: Detail }) {
  const { canWriteBusinesses, canExport, canRunAnalysis, canManageLists, canWorkLeads } =
    usePermissions();
  const [addToListOpen, setAddToListOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const memberships = useLeadLists({ businessId: detail.id, pageSize: 50 }, canManageLists);
  const [tab, setTab] = useUrlState(parseTab, serializeTab);
  const [correction, setCorrection] = useState<CorrectionTarget | null>(null);
  const [suppressOpen, setSuppressOpen] = useState(false);
  const [unsuppressOpen, setUnsuppressOpen] = useState(false);
  const [refreshOpen, setRefreshOpen] = useState(false);
  const runs = useEnrichmentRuns(detail.id);
  const checkEmail = useCheckEmail(detail.id);
  const blocker = analysisBlocker(detail);

  // Addresses with an email check queued or running (from the polled runs, plus a request in flight).
  const checkingEmails = useMemo(() => {
    const set = new Set<string>();
    for (const r of runs.data?.data ?? []) {
      if (r.kind === "email_check" && isRunActive(r) && r.input.address) set.add(r.input.address);
    }
    if (checkEmail.isPending && checkEmail.variables) set.add(checkEmail.variables);
    return set;
  }, [runs.data, checkEmail.isPending, checkEmail.variables]);

  const contactActions: ContactActions | undefined = canRunAnalysis
    ? {
        onRefresh: blocker ? undefined : () => setRefreshOpen(true),
        refreshUnavailable: blocker
          ? `Refresh is not available: ${blocker.charAt(0).toLowerCase()}${blocker.slice(1)}`
          : undefined,
        onCheckEmail: (address) =>
          checkEmail.mutate(address, {
            onSuccess: () =>
              toast.success("Checking the email address", {
                description:
                  "Free. Syntax, mail server and disposable-domain checks; the mailbox is never contacted.",
              }),
            onError: (err) => {
              const e = enrichmentRequestError(err);
              toast.error(e.title, { description: e.message });
            },
          }),
        checkingEmails,
      }
    : {
        refreshUnavailable:
          "Refreshing needs an owner, administrator or researcher, because it fetches the business's website.",
      };
  const unsuppress = useUnsuppressBusiness(detail.id);
  const target = useMemo(() => activityTargetOf(detail), [detail]);

  const onCorrect = useCallback((t: CorrectionTarget) => setCorrection(t), []);
  const name = detail.name.value ?? EXPIRED_NAME_LABEL;
  const location = fullLocation(detail.location.value);
  const suppressed = detail.suppression.suppressed;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Businesses", href: "/app/businesses" }, { label: name }]}
            renderLink={renderBreadcrumbLink}
          />
        }
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            Business
            {suppressed ? (
              <Badge variant="warning">
                <EyeOff aria-hidden /> Suppressed
              </Badge>
            ) : null}
          </span>
        }
        title={
          <span className={detail.name.value ? undefined : "text-muted-foreground italic"}>
            {name}
          </span>
        }
        description={
          [detail.categories.map((c) => c.value).join(" · "), location]
            .filter(Boolean)
            .join(" — ") || "No category or location recorded"
        }
        actions={
          <>
            {canWriteBusinesses ? (
              <Button onClick={() => setCorrection({ field: "name" })}>
                <Pencil aria-hidden /> Correct details
              </Button>
            ) : null}
            {canManageLists && !suppressed ? (
              <Button variant="outline" onClick={() => setAddToListOpen(true)}>
                <ListPlus aria-hidden /> Add to list
              </Button>
            ) : null}
            {canWriteBusinesses ? (
              suppressed ? (
                <Button variant="outline" onClick={() => setUnsuppressOpen(true)}>
                  <Eye aria-hidden /> Remove suppression
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setSuppressOpen(true)}>
                  <EyeOff aria-hidden /> Suppress
                </Button>
              )
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More actions">
                  <EllipsisVertical aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() =>
                    void navigator.clipboard.writeText(detail.id).then(
                      () => toast.success("Business ID copied"),
                      () => toast.error("Could not copy the business ID"),
                    )
                  }
                >
                  <Copy aria-hidden /> Copy business ID
                </DropdownMenuItem>
                {canWorkLeads ? (
                  <DropdownMenuItem onSelect={() => setLogOpen(true)}>
                    <MessageSquarePlus aria-hidden /> Log activity
                  </DropdownMenuItem>
                ) : null}
                {canExport ? (
                  <DropdownMenuItem disabled={suppressed} onSelect={() => setExportOpen(true)}>
                    <Download aria-hidden />
                    {suppressed
                      ? "Export (suppressed businesses are never exported)"
                      : "Export this business"}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span>
          Sources:{" "}
          <span className="text-foreground">
            {detail.sources.map((s) => sourceLabel(s.source)).join(", ") || "none"}
          </span>
        </span>
        <span>Updated {formatRelative(detail.updatedAt)}</span>
        {detail.whatsapp !== "unknown" ? (
          <WhatsAppIndicator status={detail.whatsapp} size="sm" />
        ) : null}
      </div>

      {detail.name.state === "expired" ? (
        <Banner
          tone="info"
          icon={TimerOff}
          title="The name is hidden under the source's terms"
          description="This business was found through a source whose terms do not allow storing its name, so the name expired when it was collected. LeadForge keeps the source's record ID and dates, and any details your team or other sources added. Correct the name if you know it."
          data-testid="expired-name-banner"
        />
      ) : null}

      {suppressed ? (
        <Banner
          tone="warning"
          icon={EyeOff}
          title="This business is suppressed"
          description={
            <span className="flex flex-col gap-1">
              <span>
                {detail.suppression.reason ? `Reason: ${detail.suppression.reason}. ` : ""}
                {detail.suppression.suppressedAt
                  ? `Suppressed ${formatDateTime(detail.suppression.suppressedAt)}. `
                  : ""}
                It is hidden from the directory by default, never exported and skipped by matching
                imports.
              </span>
              {detail.suppression.entries.length ? (
                <span className="text-xs">
                  {plural(
                    detail.suppression.entries.length,
                    "suppression entry",
                    "suppression entries",
                  )}
                  : {detail.suppression.entries.map((e) => `${e.kind} ${e.value}`).join("; ")}
                </span>
              ) : null}
            </span>
          }
          actions={
            canWriteBusinesses ? (
              <Button variant="outline" size="sm" onClick={() => setUnsuppressOpen(true)}>
                Remove suppression
              </Button>
            ) : undefined
          }
        />
      ) : null}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab, { push: true })}>
        <TabsList aria-label="Business sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="provenance">
            Provenance
            <span className="text-muted-foreground text-xs tabular-nums">
              {detail.provenance.totalObservations}
            </span>
          </TabsTrigger>
          <TabsTrigger value="verification">Verification</TabsTrigger>
          <TabsTrigger value="analysis">Website analysis</TabsTrigger>
          <TabsTrigger value="score">Lead score</TabsTrigger>
          <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
          <TabsTrigger value="duplicates">
            Duplicates
            {detail.dedup.candidateCount ? (
              <span className="text-muted-foreground text-xs tabular-nums">
                {detail.dedup.candidateCount}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="activities">Activities</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <ContactsPanel
                detail={detail}
                onCorrect={canWriteBusinesses ? onCorrect : undefined}
                actions={contactActions}
              />
              <ContactCollectionCard
                detail={detail}
                canRun={canRunAnalysis}
                onRefresh={() => setRefreshOpen(true)}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <LeadPanel
                businessId={detail.id}
                businessName={name}
                suppressed={suppressed}
                onLogActivity={() => setLogOpen(true)}
              />
              <BusinessListsCard
                businessId={detail.id}
                onAdd={suppressed ? undefined : () => setAddToListOpen(true)}
              />
              <LocationPanel
                detail={detail}
                onCorrect={canWriteBusinesses ? onCorrect : undefined}
                actions={contactActions}
              />
              <CategoriesCard
                detail={detail}
                onCorrect={canWriteBusinesses ? onCorrect : undefined}
              />
              <SourcesCard detail={detail} />
              <AttributionCard detail={detail} />
              <RecordCard detail={detail} />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="provenance">
          <ProvenancePanel detail={detail} />
        </TabsContent>
        <TabsContent value="verification">
          <VerificationPanel detail={detail} />
        </TabsContent>
        <TabsContent value="analysis">
          {tab === "analysis" ? <AnalysisTab detail={detail} /> : null}
        </TabsContent>
        <TabsContent value="score">
          <ScoreTab detail={detail} />
        </TabsContent>
        <TabsContent value="opportunities">
          {tab === "opportunities" ? <OpportunitiesTab detail={detail} /> : null}
        </TabsContent>
        <TabsContent value="duplicates">
          {tab === "duplicates" ? <DuplicatesTab detail={detail} /> : null}
        </TabsContent>
        <TabsContent value="activities">
          {tab === "activities" ? (
            <div
              className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
              data-testid="activities-tab"
            >
              <Card>
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                  <CardTitle>Activity</CardTitle>
                  {canWorkLeads ? (
                    <Button size="sm" onClick={() => setLogOpen(true)}>
                      <MessageSquarePlus aria-hidden /> Log activity
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent>
                  <ActivityFeed businessId={detail.id} />
                </CardContent>
              </Card>
              <div className="flex min-w-0 flex-col gap-4">
                <OutreachPanel business={target} />
              </div>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>

      {canWorkLeads ? (
        <LogActivityDialog open={logOpen} onOpenChange={setLogOpen} business={target} />
      ) : null}
      {canManageLists ? (
        <AddToListDialog
          open={addToListOpen}
          onOpenChange={setAddToListOpen}
          businessIds={[detail.id]}
          businessName={name}
          memberOf={memberships.data?.data.map((l) => l.id) ?? []}
        />
      ) : null}
      {canExport ? (
        <ExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          request={{ kind: "selection", ids: [detail.id] }}
          what={name}
          count={1}
        />
      ) : null}

      {canRunAnalysis ? (
        <RefreshDialog detail={detail} open={refreshOpen} onOpenChange={setRefreshOpen} />
      ) : null}

      {canWriteBusinesses ? (
        <>
          <CorrectionDialog
            detail={detail}
            target={correction}
            onOpenChange={(o) => !o && setCorrection(null)}
          />
          <SuppressDialog detail={detail} open={suppressOpen} onOpenChange={setSuppressOpen} />
          <ConfirmDialog
            open={unsuppressOpen}
            onOpenChange={setUnsuppressOpen}
            title="Remove suppression?"
            description="This removes the suppression entries created from this business. If another entry still matches its domain, a phone or an email, it stays suppressed."
            confirmLabel="Remove suppression"
            loading={unsuppress.isPending}
            onConfirm={() =>
              unsuppress.mutate(undefined, {
                onSuccess: (d) => {
                  setUnsuppressOpen(false);
                  toast.success(
                    d.suppression.suppressed
                      ? "Still suppressed by another entry"
                      : "Suppression removed",
                    d.suppression.suppressed
                      ? {
                          description:
                            "A shared domain, phone or email is suppressed from another business.",
                        }
                      : undefined,
                  );
                },
                onError: (err) =>
                  toast.error("Could not remove the suppression", {
                    description: friendlyMessage(err),
                  }),
              })
            }
          />
        </>
      ) : null}
    </div>
  );
}

function CategoriesCard({
  detail,
  onCorrect,
}: {
  detail: Detail;
  onCorrect?: (t: CorrectionTarget) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Categories</CardTitle>
        {onCorrect ? (
          <Button
            variant="text"
            size="sm"

            onClick={() => onCorrect({ field: "categories" })}
          >
            <Pencil aria-hidden /> Correct
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {detail.categories.length ? (
          <>
            <ul className="flex min-w-0 flex-wrap gap-1.5">
              {detail.categories.map((c) => (
                <li key={c.key}>
                  <Badge variant="neutral" title={`Taxonomy: ${c.taxonomy}`}>
                    {c.value}
                  </Badge>
                </li>
              ))}
            </ul>
            <CategoryFootnote detail={detail} />
          </>
        ) : (
          <p className="text-muted-foreground text-sm">No category recorded.</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Where the categories came from and when they were last observed. */
function CategoryFootnote({ detail }: { detail: Detail }) {
  const ids = detail.categories.flatMap((c) => c.observationIds);
  const sources = sourcesFor(ids, detail.provenance.recent);
  const latest = detail.provenance.recent
    .filter((o) => o.field === "category")
    .map((o) => o.collectedAt)
    .sort()
    .pop();
  if (!sources.length && !latest) return null;
  return (
    <p className="text-muted-foreground mt-3 text-xs">
      {sources.length ? `From ${sources.join(", ")}` : ""}
      {latest ? `${sources.length ? " · " : ""}last observed ${formatDateTime(latest)}` : ""}
    </p>
  );
}

function SourcesCard({ detail }: { detail: Detail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sources</CardTitle>
      </CardHeader>
      <CardContent>
        {detail.sources.length ? (
          <ul className="divide-border flex min-w-0 flex-col divide-y">
            {detail.sources.map((s) => (
              <li
                key={s.source}
                className="flex min-w-0 flex-col gap-0.5 py-2 first:pt-0 last:pb-0"
              >
                <span className="text-sm font-medium">{sourceLabel(s.source)}</span>
                <span className="text-muted-foreground text-xs">
                  {plural(s.observationCount, "observation", "observations")} · first{" "}
                  {formatDate(s.firstSeenAt)} · last {formatDate(s.lastSeenAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No sources recorded.</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Attribution this record must show wherever it is displayed (one entry per source that requires
 * it), with the verbatim provider lines and the licences. Hidden when no source requires any.
 */
function AttributionCard({ detail }: { detail: Detail }) {
  const attributions = detail.attributions ?? [];
  if (!attributions.length) return null;
  return (
    <Card data-testid="business-attribution">
      <CardHeader>
        <CardTitle>Attribution</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-border flex min-w-0 flex-col divide-y">
          {attributions.map((a) => (
            <li key={a.source} className="flex min-w-0 flex-col gap-1 py-2 first:pt-0 last:pb-0">
              <span className="break-anywhere text-sm">{a.text}</span>
              {a.lines.map((line) => (
                <span key={line} className="text-muted-foreground break-anywhere text-xs">
                  {line}
                </span>
              ))}
              {a.licenses.length ? (
                <span className="text-muted-foreground break-anywhere text-xs">
                  Licences:{" "}
                  {a.licenses.map((l, i) => (
                    <span key={l.id}>
                      {i > 0 ? ", " : ""}
                      <Link href={licenseAnchor(l.id)} className="link-inline rounded-xs">
                        {l.name}
                      </Link>
                    </span>
                  ))}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function RecordCard({ detail }: { detail: Detail }) {
  const via = detail.createdVia;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Record</CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <dl className="flex min-w-0 flex-col gap-2.5 text-sm">
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">Business ID</dt>
            <dd>
              <CopyableValue value={detail.id} label="business ID" />
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">Name</dt>
            <dd>
              <FieldStatus state={detail.name.state} size="sm" />
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">Created</dt>
            <dd>
              {formatDateTime(detail.createdAt)} · {CREATED_VIA[via.kind]}
              {via.importId ? (
                <>
                  {" "}
                  <Link href={`/app/businesses/import?id=${via.importId}`} className="link-inline">
                    View import
                  </Link>
                </>
              ) : null}
              {via.discoveryJobId ? (
                <>
                  {" "}
                  <Link href={`/app/discovery/${via.discoveryJobId}`} className="link-inline">
                    View discovery job
                  </Link>
                </>
              ) : null}
            </dd>
          </div>
          {detail.externalRefs.length ? (
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">Source records</dt>
              <dd className="flex min-w-0 flex-col gap-1.5">
                {detail.externalRefs.map((r) => (
                  <span key={`${r.source}-${r.externalId}`} className="flex min-w-0 flex-col">
                    <span className="text-xs">
                      {sourceLabel(r.source)} · fetched {formatDate(r.lastFetchedAt)}
                    </span>
                    <CopyableValue value={r.externalId} label="source record ID" mono />
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">Last verified</dt>
            <dd>
              {detail.lastVerifiedAt ? formatDateTime(detail.lastVerifiedAt) : "Never verified"}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">Duplicates</dt>
            <dd className="flex min-w-0 flex-col gap-0.5">
              <span>
                {detail.dedup.status === "has_candidates"
                  ? plural(detail.dedup.candidateCount, "possible duplicate", "possible duplicates")
                  : detail.dedup.status === "merged_into"
                    ? "Merged into another record"
                    : "No possible duplicates waiting for review"}
                {detail.dedup.absorbedIds.length
                  ? ` · ${plural(detail.dedup.absorbedIds.length, "record", "records")} merged into this one`
                  : ""}
              </span>
              <Link
                href={`/app/businesses/${detail.id}?tab=duplicates`}
                className="text-primary rounded-xs text-xs hover:underline"
              >
                Review duplicates and merge history
              </Link>
            </dd>
          </div>
        </dl>
        <PanelFootnote detail={detail} showSources={false} />
      </CardContent>
    </Card>
  );
}
