"use client";

import type { OrganizationDataExport, OrganizationProfile } from "@leadforge/contracts";
import {
  CalendarClock,
  Download,
  FileArchive,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Undo2,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banner,
  Button,
  Card,
  CardTitle,
  ConfirmDialog,
  ErrorState,
  FadeIn,
  Heading,
  JobStatus,
  LiveAnnouncement,
  Progress,
  Separator,
  Skeleton,
  toast,
} from "@leadforge/ui";
import { isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelative,
} from "@/lib/format";
import { useMembers } from "@/lib/hooks/use-members";
import {
  useCancelDeletion,
  useCreateOrgDataExport,
  useDownloadOrgDataExport,
  useOrgDataExport,
  useOrgDataExports,
} from "@/lib/hooks/use-org-lifecycle";
import { usePermissions } from "@/lib/hooks/use-permissions";
import {
  activeExportIdFrom,
  daysUntil,
  deletionStateOf,
  isOrgExportActive,
  ORG_EXPORT_DOWNLOAD_ERROR_MESSAGES,
  ORG_EXPORT_SECTION_LABELS,
  ORG_EXPORT_STATUS_LABELS,
  ORG_LIFECYCLE_ANCHOR,
  orgExportDownloadErrorFrom,
  orgExportJobState,
  purgeDateLabel,
} from "@/lib/org-lifecycle";
import { DeleteOrganizationDialog } from "./delete-organization-dialog";

/** State swaps (export progress, pending deletion) fade in over 250 ms; static under reduced motion. */
const SWAP = 0.25;
/** Long labels wrap inside narrow screens (240px) instead of sticking out of the card. */
const WRAP = "h-auto min-h-10 max-w-full whitespace-normal py-2 text-left";
const WRAP_SM = "h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

/** Names of the organization's active owners ("Ada Okafor and Tunde Bello"), or null while unknown. */
function useOwnerNames(): string | null {
  const members = useMembers();
  return useMemo(() => {
    const owners = (members.data?.data ?? [])
      .filter((m) => m.role === "owner" && m.status === "active")
      .map((m) => m.name);
    if (!owners.length) return null;
    if (owners.length === 1) return owners[0]!;
    return `${owners.slice(0, -1).join(", ")} and ${owners[owners.length - 1]}`;
  }, [members.data]);
}

/**
 * Settings, Organization: "Data and deletion" (Stage 10). Owners export everything the workspace
 * holds as one ZIP of JSON and CSV files, and can schedule the organization for deletion (typed
 * name and current password; 14 days of grace in which any owner can cancel). Other roles see the
 * same facts read-only and who can act. A failed export link lands here with `downloadError`,
 * which is explained once and dropped from the URL.
 */
export function DataAndDeletionSection({
  profile,
  navigate,
}: {
  profile: OrganizationProfile;
  /** Where the browser goes for a download (tests pass a spy); defaults to location.assign. */
  navigate?: (url: string) => void;
}) {
  const { can } = usePermissions();
  const owner = can("organization:delete");
  const exporter = can("organization:export");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const linkCode = orgExportDownloadErrorFrom(params.get("downloadError"));
  const [linkError, setLinkError] = useState<typeof linkCode>(null);
  const linkErrorRef = useRef<HTMLDivElement>(null);

  // A failed export link lands on /app/settings?tab=organization&downloadError=<code> (303 from
  // the API). Say what happened once, then drop the parameter so a reload does not repeat it.
  useEffect(() => {
    if (!linkCode) return;
    setLinkError(linkCode);
    router.replace(`${pathname}?tab=organization`, { scroll: false });
  }, [linkCode, pathname, router]);
  useEffect(() => {
    if (linkError) {
      linkErrorRef.current?.scrollIntoView({ block: "center" });
      linkErrorRef.current?.focus({ preventScroll: true });
    }
  }, [linkError]);

  return (
    <Card
      id={ORG_LIFECYCLE_ANCHOR}
      className="max-w-3xl scroll-mt-24"
      data-testid="data-and-deletion"
    >
      <div className="flex flex-col gap-1 p-5 pb-2 sm:p-6 sm:pb-2">
        <CardTitle className="leading-normal">Data and deletion</CardTitle>
        <p className="text-muted-foreground text-sm">
          Take a copy of everything this workspace holds, or delete the organization.
        </p>
      </div>
      {linkError ? (
        <div className="px-5 pt-2 sm:px-6">
          <div
            ref={linkErrorRef}
            tabIndex={-1}
            className="focus-visible:ring-ring rounded-md outline-none focus-visible:ring-2"
          >
            <Banner
              tone="warning"
              title={ORG_EXPORT_DOWNLOAD_ERROR_MESSAGES[linkError].title}
              description={ORG_EXPORT_DOWNLOAD_ERROR_MESSAGES[linkError].message}
              onDismiss={() => setLinkError(null)}
              dismissLabel="Dismiss: download problem"
              data-testid="org-export-link-problem"
            />
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-0 p-5 pt-4 sm:p-6 sm:pt-4">
        <ExportPanel enabled={exporter} navigate={navigate} />
        <Separator className="my-6" />
        <DeletionPanel profile={profile} owner={owner} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Export organization data
// ---------------------------------------------------------------------------

function exportAnnouncement(e: OrganizationDataExport | undefined): string {
  if (!e) return "";
  switch (e.status) {
    case "queued":
      return "Organization export queued.";
    case "running":
      return "Building the organization export.";
    case "completed":
      return "The organization export is ready to download.";
    case "failed":
      return "The organization export failed.";
    default:
      return "The organization export has expired.";
  }
}

function ExportPanel({
  enabled,
  navigate,
}: {
  enabled: boolean;
  navigate?: (url: string) => void;
}) {
  const owners = useOwnerNames();
  const list = useOrgDataExports(enabled);
  const create = useCreateOrgDataExport();
  const download = useDownloadOrgDataExport(navigate);
  const [followId, setFollowId] = useState<string | null>(null);
  const latest = list.data?.data[0] ?? null;
  const currentId = followId ?? latest?.id ?? null;
  const detail = useOrgDataExport(enabled ? currentId : null);
  const current: OrganizationDataExport | null =
    detail.data && detail.data.id === currentId
      ? detail.data
      : currentId === latest?.id
        ? latest
        : null;
  const announcement = useMemo(() => exportAnnouncement(current ?? undefined), [current?.status]);

  const request = () =>
    create.mutate(undefined, {
      onSuccess: (e) => setFollowId(e.id),
      onError: (err) => {
        const active = activeExportIdFrom(err);
        if (active) setFollowId(active);
      },
    });

  const heading = (
    <div className="flex min-w-0 flex-col gap-1">
      <Heading className="flex items-center gap-2 text-sm font-medium">
        <FileArchive aria-hidden className="text-muted-foreground size-4" /> Export organization
        data
      </Heading>
      <p className="text-muted-foreground text-sm">
        One ZIP with JSON and CSV files: the organization profile, members (name, email, role,
        joined), businesses with their stored fields and provenance, lists, leads, activities,
        outreach, imports and jobs, the credit ledger, invoices and payments (no card data), usage
        and the audit log. Values whose source retention has ended are left out, as in every export.
        Spreadsheet formulas are neutralized.
      </p>
    </div>
  );

  if (!enabled) {
    return (
      <section
        className="flex min-w-0 flex-col gap-3"
        data-testid="org-export"
        data-state="not-owner"
      >
        {heading}
        <p
          className="bg-surface-container-low rounded-md px-4 py-3 text-sm"
          data-testid="org-export-owners-only"
        >
          Only owners can export the organization&apos;s data, because the file includes every
          member&apos;s email address.{owners ? ` Ask ${owners}.` : " Ask an owner."}
        </p>
      </section>
    );
  }

  const conflict = activeExportIdFrom(create.error);
  const createError = create.isError && !conflict ? create.error : null;
  const downloadCode = isApiError(download.error) ? download.error.code : null;
  const downloadProblem = orgExportDownloadErrorFrom(downloadCode);
  const active = isOrgExportActive(current);
  const ready = current?.status === "completed" && Boolean(current.file?.available);
  const expired =
    current?.status === "expired" ||
    (current?.status === "completed" && current.file && !current.file.available);

  let body: React.ReactNode;
  let state: string;
  if (list.isPending && !followId) {
    state = "loading";
    body = (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading organization exports"
        className="flex flex-col gap-2"
      >
        <Skeleton className="h-4 w-56 max-w-full" />
        <Skeleton className="h-10 w-40" />
      </div>
    );
  } else if (list.isError && !current) {
    state = "error";
    body = (
      <ErrorState
        title="Could not load organization exports"
        message={friendlyMessage(list.error)}
        requestId={requestIdOf(list.error)}
        onRetry={() => void list.refetch()}
      />
    );
  } else if (!current) {
    state = "none";
    body = (
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-sm">
          No organization export yet. The file is built in the background; you get a notification
          when it is ready.
        </p>
        <div>
          <Button
            className={WRAP}
            onClick={request}
            loading={create.isPending}
            data-testid="org-export-request"
          >
            <Download aria-hidden /> Request export
          </Button>
        </div>
      </div>
    );
  } else {
    state = current.status;
    const p = current.progress;
    body = (
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <JobStatus
            state={orgExportJobState(current.status)}
            label={ORG_EXPORT_STATUS_LABELS[current.status]}
            data-testid="org-export-status"
          />
          <span className="text-muted-foreground text-xs">
            Requested {formatDateTime(current.createdAt)}
          </span>
        </div>
        {active ? (
          <Progress
            label="Organization export progress"
            value={p.totalSections ? p.completedSections : undefined}
            max={p.totalSections || undefined}
            valueText={
              current.status === "queued"
                ? "Queued: waiting for a worker"
                : `${formatNumber(p.completedSections)} of ${formatNumber(p.totalSections)} sections${
                    p.currentSection
                      ? ` · writing ${ORG_EXPORT_SECTION_LABELS[p.currentSection].toLowerCase()}`
                      : ""
                  }`
            }
            showLabel
          />
        ) : null}
        {current.status === "failed" ? (
          <Banner
            tone="destructive"
            title="The export failed"
            description={`${current.error?.message ?? "The file could not be built."} Request it again to retry.`}
            data-testid="org-export-failed"
          />
        ) : null}
        {expired ? (
          <Banner
            tone="info"
            title="This export has expired"
            description="Export files are deleted 7 days after they are built. Request a new export for a fresh file."
            data-testid="org-export-expired"
          />
        ) : null}
        {current.file && ready ? (
          <dl className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-3">
            <Fact label="File">
              <span className="break-anywhere font-mono text-[13px]">{current.file.name}</span>
            </Fact>
            <Fact label="Size">{formatBytes(current.file.bytes)}</Fact>
            <Fact label="Deleted on">{formatDate(current.file.expiresAt)}</Fact>
          </dl>
        ) : null}
        {current.status === "completed" && current.sections.length ? (
          <p className="text-muted-foreground text-xs">
            {current.sections
              .filter((s) => s.key !== "organization")
              .map((s) => `${ORG_EXPORT_SECTION_LABELS[s.key]} ${formatNumber(s.rows)}`)
              .join(" · ")}
          </p>
        ) : null}
        <div className="flex min-w-0 flex-wrap gap-2">
          {ready ? (
            <Button
              className={WRAP}
              loading={download.isPending}
              onClick={() => download.mutate(current.id)}
              data-testid="org-export-download"
            >
              <Download aria-hidden /> Download ZIP
            </Button>
          ) : null}
          {!active ? (
            <Button
              className={WRAP}
              variant={ready ? "outline" : "primary"}
              onClick={request}
              loading={create.isPending}
              data-testid="org-export-request"
            >
              <RotateCcw aria-hidden /> Request a new export
            </Button>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">
          {active
            ? "Refreshing every 2 seconds. You can leave this page; you get a notification when the file is ready."
            : "Files are kept 7 days. Each download asks for a new link that works for 15 minutes, for you only."}
        </p>
      </div>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-4" data-testid="org-export" data-state={state}>
      {heading}
      <LiveAnnouncement message={announcement} data-testid="org-export-announcer" />
      <FadeIn key={state} duration={SWAP}>
        {body}
      </FadeIn>
      {downloadProblem ? (
        <Banner
          tone="warning"
          title={ORG_EXPORT_DOWNLOAD_ERROR_MESSAGES[downloadProblem].title}
          description={ORG_EXPORT_DOWNLOAD_ERROR_MESSAGES[downloadProblem].message}
          data-testid="org-export-download-problem"
        />
      ) : download.isError ? (
        <ErrorState
          title="Could not get a download link"
          message={friendlyMessage(download.error)}
          requestId={requestIdOf(download.error)}
        />
      ) : null}
      {conflict ? (
        <p className="text-muted-foreground text-sm" data-testid="org-export-conflict">
          An export is already being built, so it is shown here instead of starting another.
        </p>
      ) : null}
      {createError ? (
        <ErrorState
          title="Could not request the export"
          message={friendlyMessage(createError)}
          requestId={requestIdOf(createError)}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Delete organization
// ---------------------------------------------------------------------------

function DeletionPanel({ profile, owner }: { profile: OrganizationProfile; owner: boolean }) {
  const owners = useOwnerNames();
  const deletion = deletionStateOf(profile);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const cancel = useCancelDeletion();
  const days = daysUntil(deletion.purgeAfter);
  const announcement = deletion.pending
    ? `This organization is scheduled for deletion on ${purgeDateLabel(deletion.purgeAfter)}.`
    : "";

  const heading = (
    <Heading className="flex items-center gap-2 text-sm font-medium">
      <Trash2 aria-hidden className="text-muted-foreground size-4" /> Delete organization
    </Heading>
  );

  return (
    <section
      className="flex min-w-0 flex-col gap-3"
      data-testid="org-deletion"
      data-state={deletion.pending ? "pending" : "none"}
    >
      {heading}
      <LiveAnnouncement message={announcement} data-testid="org-deletion-announcer" />
      <FadeIn key={deletion.pending ? "pending" : "none"} duration={SWAP}>
        {deletion.pending ? (
          <div className="flex min-w-0 flex-col gap-3">
            <Banner
              tone="warning"
              icon={CalendarClock}
              title={`Scheduled for deletion on ${purgeDateLabel(deletion.purgeAfter)}`}
              description={`Requested ${formatRelative(deletion.requestedAt)}${
                days !== null
                  ? `; ${days === 0 ? "the purge can start at any time now" : `${days} day${days === 1 ? "" : "s"} left`}`
                  : ""
              }. Then the workspace's data is purged and accounts with no other membership are erased; billing records are kept. ${
                owner
                  ? "Cancel to keep everything."
                  : `Only owners can cancel it${owners ? `: ask ${owners}` : ""} if this workspace should be kept.`
              }`}
              data-testid="org-deletion-pending"
              actions={
                owner ? (
                  <Button
                    className={WRAP_SM}
                    variant="outline"
                    size="sm"
                    onClick={() => setCancelOpen(true)}
                    data-testid="org-deletion-cancel"
                  >
                    <Undo2 aria-hidden /> Cancel deletion
                  </Button>
                ) : undefined
              }
            />
            {cancel.isError ? (
              <ErrorState
                title="Could not cancel the deletion"
                message={friendlyMessage(cancel.error)}
                requestId={requestIdOf(cancel.error)}
              />
            ) : null}
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-sm">
              Deleting the organization schedules a purge 14 days later. Until then everyone keeps
              working, except that new discovery, website analysis, imports, purchases and
              invitations pause, and any owner can cancel. Then the workspace&apos;s data is deleted
              for good; payments, invoices, refunds, the credit ledger and the audit logs are kept
              for the period the law requires.
            </p>
            {owner ? (
              <div>
                <Button
                  className={WRAP}
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                  data-testid="org-delete-open"
                >
                  <Trash2 aria-hidden /> Delete organization…
                </Button>
              </div>
            ) : (
              <p
                className="bg-surface-container-low flex items-start gap-2 rounded-md px-4 py-3 text-sm"
                data-testid="org-delete-owners-only"
              >
                <ShieldCheck aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <span>
                  Only owners can delete the organization.
                  {owners ? ` The owners are ${owners}.` : ""}
                </span>
              </p>
            )}
          </div>
        )}
      </FadeIn>
      {owner ? (
        <DeleteOrganizationDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          organizationName={profile.name}
        />
      ) : null}
      {owner ? (
        <ConfirmDialog
          open={cancelOpen}
          onOpenChange={(o) => {
            setCancelOpen(o);
            if (!o) cancel.reset();
          }}
          title="Cancel the scheduled deletion?"
          description="The organization and all its data stay. Discovery, website analysis, imports, purchases and invitations work again at once, and every owner and administrator is told."
          confirmLabel="Cancel deletion"
          cancelLabel="Keep it scheduled"
          loading={cancel.isPending}
          onConfirm={() =>
            cancel.mutate(undefined, {
              onSuccess: () => {
                setCancelOpen(false);
                toast.success("Deletion cancelled", {
                  description: "The organization and its data stay.",
                });
              },
              onError: () => setCancelOpen(false),
            })
          }
        />
      ) : null}
    </section>
  );
}
