"use client";

import { type Lead } from "@leadforge/contracts";
import { Kanban, MessageSquarePlus, PencilLine, Plus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  LiveAnnouncement,
  Skeleton,
  toast,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { formatMoney } from "@/lib/billing";
import { PRIORITY_LABELS, stageLabel } from "@/lib/crm";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useMemberNames } from "@/lib/hooks/use-members";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useBusinessLead, useCreateLead, usePipelineConfig } from "@/lib/hooks/use-pipeline";
import { AssignLeadDialog } from "./assign-lead-dialog";
import { LeadDetailsDialog, type LeadField } from "./lead-details-dialog";
import { MoveToMenu, StageStepButtons, useLeadMover } from "./lead-move";

/**
 * The business's place in the sales pipeline (business detail): stage and owner with quick
 * actions (previous or next stage, Move to…, Assign, Log activity). Lead state is kept apart from
 * the business's facts and from its score.
 */
export function LeadPanel({
  businessId,
  businessName,
  suppressed,
  onLogActivity,
}: {
  businessId: string;
  businessName: string;
  suppressed: boolean;
  onLogActivity?: () => void;
}) {
  const { me } = useWorkspace();
  const { canWorkLeads, canAssignLeads } = usePermissions();
  const lead = useBusinessLead(businessId);
  const config = usePipelineConfig();
  const member = useMemberNames();
  const create = useCreateLead();
  const [message, setMessage] = useState("");
  const [details, setDetails] = useState<{ focus?: LeadField } | null>(null);
  const mover = useLeadMover(config.data, setMessage, undefined, (_l, field) =>
    setDetails({ focus: field }),
  );
  const [assignOpen, setAssignOpen] = useState(false);
  const l: Lead | null | undefined = lead.data;
  const followUp: LeadField | null =
    l && canWorkLeads
      ? l.stageKind === "won" && l.wonValueMinor === null
        ? "wonValue"
        : l.stageKind === "lost" && !l.lostReason
          ? "lostReason"
          : null
      : null;

  return (
    <Card data-testid="lead-panel">
      <CardHeader>
        <CardTitle>Pipeline</CardTitle>
        <CardDescription>
          Sales stage and owner. Kept apart from the business details and its score.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <LiveAnnouncement message={message} />
        {lead.isPending ? (
          <div
            role="status"
            aria-busy="true"
            aria-label="Loading pipeline stage"
            className="flex flex-col gap-2"
          >
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-56" />
          </div>
        ) : lead.isError ? (
          <ErrorState
            title="Could not load the pipeline stage"
            message={friendlyMessage(lead.error)}
            requestId={requestIdOf(lead.error)}
            onRetry={() => void lead.refetch()}
          />
        ) : l ? (
          <>
            <dl className="grid min-w-0 grid-cols-1 gap-3 text-sm min-[480px]:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-muted-foreground text-xs">Stage</dt>
                <dd className="flex min-w-0 flex-wrap items-center gap-2" data-testid="lead-stage">
                  <span className="font-medium">{stageLabel(config.data, l.stageKey)}</span>
                  {l.stageKind !== "open" ? (
                    <Badge variant={l.stageKind === "won" ? "success" : "neutral"}>
                      {l.stageKind === "won" ? "Won" : "Lost"}
                    </Badge>
                  ) : null}
                  <span className="text-muted-foreground text-xs">
                    since {formatRelative(l.stageEnteredAt)}
                  </span>
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-muted-foreground text-xs">Owner</dt>
                <dd data-testid="lead-owner">
                  {l.assignedToUserId ? (
                    l.assignedToUserId === me.user.id ? (
                      "You"
                    ) : (
                      member(l.assignedToUserId)
                    )
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-muted-foreground text-xs">Last activity</dt>
                <dd>{l.lastActivityAt ? formatDateTime(l.lastActivityAt) : "None logged yet"}</dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-muted-foreground text-xs">Priority</dt>
                <dd data-testid="lead-priority">
                  {l.priority ? (
                    PRIORITY_LABELS[l.priority]
                  ) : (
                    <span className="text-muted-foreground">Not set</span>
                  )}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-muted-foreground text-xs">Next action</dt>
                <dd data-testid="lead-next-action">
                  {l.nextActionAt ? (
                    formatDateTime(l.nextActionAt)
                  ) : (
                    <span className="text-muted-foreground">Not planned</span>
                  )}
                </dd>
              </div>
              {l.stageKind === "won" ? (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-muted-foreground text-xs">Won value</dt>
                  <dd data-testid="lead-won-value">
                    {l.wonValueMinor !== null && l.currency ? (
                      formatMoney(l.wonValueMinor, l.currency)
                    ) : (
                      <span className="text-muted-foreground">Not recorded</span>
                    )}
                  </dd>
                </div>
              ) : null}
              {l.stageKind === "lost" ? (
                <div className="flex min-w-0 flex-col gap-0.5 min-[480px]:col-span-2">
                  <dt className="text-muted-foreground text-xs">Lost reason</dt>
                  <dd className="break-words" data-testid="lead-lost-reason">
                    {l.lostReason ?? <span className="text-muted-foreground">Not recorded</span>}
                  </dd>
                </div>
              ) : null}
            </dl>
            {followUp ? (
              <div
                className="bg-surface-container-low flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-sm"
                data-testid="lead-follow-up"
              >
                <span>
                  {followUp === "wonValue"
                    ? "Optional: record what the deal is worth."
                    : "Optional: record why it was lost."}
                </span>
                <Button size="sm" variant="text" onClick={() => setDetails({ focus: followUp })}>
                  {followUp === "wonValue" ? "Record won value…" : "Record lost reason…"}
                </Button>
              </div>
            ) : null}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {canWorkLeads ? (
                <>
                  <StageStepButtons
                    lead={l}
                    config={config.data}
                    labels
                    onStep={(direction) => mover.move(l, { direction })}
                  />
                  <MoveToMenu
                    lead={l}
                    config={config.data}
                    onMove={(stageKey) => mover.move(l, { stageKey })}
                  />
                </>
              ) : null}
              {canAssignLeads ? (
                <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>
                  <UserPlus aria-hidden /> Assign…
                </Button>
              ) : null}
              {canWorkLeads ? (
                <Button size="sm" variant="outline" onClick={() => setDetails({})}>
                  <PencilLine aria-hidden /> Edit details…
                </Button>
              ) : null}
              {canWorkLeads && onLogActivity ? (
                <Button size="sm" variant="tonal" onClick={onLogActivity}>
                  <MessageSquarePlus aria-hidden /> Log activity
                </Button>
              ) : null}
              <Button asChild size="sm" variant="text">
                <Link
                  href={`/app/pipeline${l.assignedToUserId ? `?assignedToUserId=${l.assignedToUserId}` : ""}`}
                >
                  <Kanban aria-hidden /> Open pipeline
                </Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-sm" data-testid="lead-stage">
              Not in the pipeline yet.
              {suppressed ? " Suppressed businesses cannot be added." : ""}
            </p>
            {!suppressed && (canWorkLeads || canAssignLeads) ? (
              <div className="flex flex-wrap gap-2">
                {canWorkLeads ? (
                  <Button
                    size="sm"
                    loading={create.isPending}
                    onClick={() =>
                      create.mutate(
                        { businessId },
                        {
                          onSuccess: (created) => {
                            const msg = `Added ${businessName} to ${stageLabel(config.data, created.stageKey)}.`;
                            setMessage(msg);
                            toast.success(msg);
                          },
                          onError: (err) =>
                            toast.error("Could not add it to the pipeline", {
                              description: friendlyMessage(err),
                            }),
                        },
                      )
                    }
                  >
                    <Plus aria-hidden /> Add to pipeline
                  </Button>
                ) : null}
                {canAssignLeads ? (
                  <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>
                    <UserPlus aria-hidden /> Add and assign…
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </CardContent>
      {canWorkLeads && l ? (
        <LeadDetailsDialog
          lead={l}
          config={config.data}
          open={details !== null}
          onOpenChange={(o) => !o && setDetails(null)}
          focus={details?.focus}
          onSaved={() => setMessage(`Saved the lead details of ${businessName}.`)}
        />
      ) : null}
      {canAssignLeads ? (
        <AssignLeadDialog
          open={assignOpen}
          onOpenChange={setAssignOpen}
          lead={l ?? null}
          businessId={businessId}
          businessName={businessName}
        />
      ) : null}
    </Card>
  );
}
