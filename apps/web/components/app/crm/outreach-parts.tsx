"use client";

import { OutreachStatus, type OutreachRecord } from "@leadforge/contracts";
import {
  CalendarClock,
  ChevronDown,
  Mail,
  MessageCircle,
  Phone,
  Send,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  Banner,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TextField,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusIndicator,
  toast,
} from "@leadforge/ui";
import {
  channelLabel,
  fromLocalInput,
  isVersionConflict,
  outcomeLabel,
  outreachStatusMeta,
  toLocalInput,
} from "@/lib/crm";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatDateTime, formatRelative, plural } from "@/lib/format";
import { useOutreach, useUpdateOutreach } from "@/lib/hooks/use-activities";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { LogActivityDialog, type ActivityTarget } from "./log-activity-dialog";

export const CHANNEL_ICONS: Record<string, LucideIcon> = {
  call: Phone,
  whatsapp: MessageCircle,
  email: Mail,
};

export function OutreachStatusBadge({ status }: { status: string }) {
  const meta = outreachStatusMeta(status);
  return (
    <StatusIndicator
      tone={meta.tone}
      label={meta.label}
      title={meta.description}
      size="sm"
      data-outreach-status={status}
    />
  );
}

/**
 * Sets an outreach record's status (PATCH with its `version`). A 409 VERSION_CONFLICT is not
 * retried: someone else changed the record, so it is reloaded and the toast explains.
 */
export function OutreachStatusMenu({ record, name }: { record: OutreachRecord; name: string }) {
  const update = useUpdateOutreach();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          loading={update.isPending}
          aria-label={`Status: change the status of ${channelLabel(record.channel)} outreach to ${name}`}
        >
          Status <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Outreach status</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={record.status}
          onValueChange={(status) => {
            if (status === record.status) return;
            update.mutate(
              { record, body: { status: status as OutreachRecord["status"] } },
              {
                onSuccess: (r) =>
                  toast.success(`Status set to ${outreachStatusMeta(r.status).label}`),
                onError: (err) =>
                  toast.error(
                    isVersionConflict(err)
                      ? "Someone else updated this record"
                      : "Could not change the status",
                    {
                      description: isVersionConflict(err)
                        ? "It was reloaded with their changes. Check the status and change it again if needed."
                        : friendlyMessage(err),
                    },
                  ),
              },
            );
          }}
        >
          {OutreachStatus.options.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {outreachStatusMeta(s).label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Plans (or clears) the next attempt on an outreach record (PATCH with `nextAttemptAt` and the
 * record's `version`). A stale version is not retried: the record reloads and the dialog explains.
 */
export function NextAttemptDialog({
  record,
  name,
  open,
  onOpenChange,
}: {
  record: OutreachRecord;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const update = useUpdateOutreach();
  const [value, setValue] = useState("");
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (open) {
      setValue(record.nextAttemptAt ? toLocalInput(record.nextAttemptAt) : "");
      setSubmitted(false);
      update.reset();
    }
    // Reset when the dialog opens.
  }, [open]);
  const iso = value ? fromLocalInput(value) : null;
  const invalid = Boolean(value) && !iso;
  const unchanged = (record.nextAttemptAt ? toLocalInput(record.nextAttemptAt) : "") === value;
  const conflict = isVersionConflict(update.error);

  const save = (next: string | null) => {
    setSubmitted(true);
    update.mutate(
      { record, body: { nextAttemptAt: next } },
      {
        onSuccess: () => {
          onOpenChange(false);
          toast.success(next ? "Next attempt planned" : "Next attempt cleared", {
            description: next
              ? `${channelLabel(record.channel)} to ${name}, ${formatDateTime(next)}.`
              : `${channelLabel(record.channel)} to ${name}.`,
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (update.isPending ? undefined : onOpenChange(o))}>
      <DialogContent size="sm" data-testid="next-attempt-dialog">
        <DialogHeader>
          <DialogTitle>Plan the next attempt</DialogTitle>
          <DialogDescription>
            When to try {channelLabel(record.channel).toLowerCase()} with {name} next. It shows on
            the outreach record and list.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4 pb-2 [--field-bg:var(--surface-elevated)]">
          {conflict ? (
            <Banner
              tone="warning"
              title="Someone else updated this record"
              description="It was reloaded with their changes, so nothing was saved. Close this, check the record, and plan the attempt again."
              data-testid="next-attempt-conflict"
            />
          ) : null}
          <TextField
            id={`${id}-when`}
            label="Next attempt"
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            hint="Your local time."
            error={submitted && invalid ? "Enter a date and time." : undefined}
          />
          {update.isError && !conflict ? (
            <ErrorState
              title="Could not save the next attempt"
              message={friendlyMessage(update.error)}
              requestId={requestIdOf(update.error)}
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          {record.nextAttemptAt ? (
            <Button
              variant="text"
              className="mr-auto"
              onClick={() => save(null)}
              disabled={update.isPending || conflict}
            >
              Clear
            </Button>
          ) : null}
          <Button variant="text" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => (invalid || !iso ? setSubmitted(true) : save(iso))}
            loading={update.isPending}
            disabled={unchanged || conflict || !value}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Next attempt…" button with its dialog, for members who work leads. */
export function NextAttemptButton({ record, name }: { record: OutreachRecord; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label={`Next attempt: plan the next ${channelLabel(record.channel)} attempt with ${name}`}
        onClick={() => setOpen(true)}
      >
        <CalendarClock aria-hidden /> Next attempt…
      </Button>
      <NextAttemptDialog record={record} name={name} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Attempts, last attempt and outcome, next attempt: one line per fact. */
export function OutreachFacts({ record }: { record: OutreachRecord }) {
  return (
    <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1.5 text-[13px] min-[480px]:grid-cols-2">
      <div className="flex min-w-0 flex-col">
        <dt className="text-muted-foreground text-xs">Attempts</dt>
        <dd className="tabular-nums">{plural(record.attempts, "attempt", "attempts")}</dd>
      </div>
      <div className="flex min-w-0 flex-col">
        <dt className="text-muted-foreground text-xs">Last attempt</dt>
        <dd>
          {record.lastAttemptAt ? (
            <time dateTime={record.lastAttemptAt} title={formatDateTime(record.lastAttemptAt)}>
              {formatRelative(record.lastAttemptAt)}
            </time>
          ) : (
            "None yet"
          )}
          {record.lastOutcome ? ` · ${outcomeLabel(record.lastOutcome)}` : ""}
        </dd>
      </div>
      <div className="flex min-w-0 flex-col">
        <dt className="text-muted-foreground text-xs">Next attempt</dt>
        <dd>{record.nextAttemptAt ? formatDateTime(record.nextAttemptAt) : "Not planned"}</dd>
      </div>
      <div className="flex min-w-0 flex-col">
        <dt className="text-muted-foreground text-xs">Last used</dt>
        <dd className="break-anywhere">{record.target ?? "Not recorded"}</dd>
      </div>
      {record.suppressionOverride ? (
        <div className="text-warning flex min-w-0 items-start gap-1 text-xs min-[480px]:col-span-2">
          <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-anywhere">
            Contacted despite suppression ({formatDateTime(record.suppressionOverride.at)}):{" "}
            {record.suppressionOverride.reason}
          </span>
        </div>
      ) : null}
    </dl>
  );
}

/**
 * Outreach records on the business page: one per channel, with attempts, the last outcome, the
 * next attempt, Log attempt and Status for members who work leads.
 */
export function OutreachPanel({ business }: { business: ActivityTarget }) {
  const { canWorkLeads } = usePermissions();
  const records = useOutreach({ businessId: business.id, pageSize: 10 });
  const [attemptOn, setAttemptOn] = useState<OutreachRecord | null>(null);
  const rows = records.data?.data ?? [];

  return (
    <Card data-testid="outreach-panel">
      <CardHeader>
        <CardTitle>Outreach</CardTitle>
        <CardDescription>
          One record per channel. Each outbound call, WhatsApp message or email you log counts as an
          attempt.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {records.isPending ? (
          <div
            role="status"
            aria-busy="true"
            aria-label="Loading outreach"
            className="flex flex-col gap-3"
          >
            <Skeleton className="h-20 rounded-md" />
          </div>
        ) : records.isError && !records.data ? (
          <ErrorState
            title="Could not load outreach records"
            message={friendlyMessage(records.error)}
            requestId={requestIdOf(records.error)}
            onRetry={() => void records.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            size="compact"
            icon={Send}
            title="No outreach yet"
            description="Log an outbound call, WhatsApp message or email and its channel's record starts here."
          />
        ) : (
          <ul
            className="divide-border flex min-w-0 flex-col divide-y"
            aria-label="Outreach records"
          >
            {rows.map((r) => {
              const Icon = CHANNEL_ICONS[r.channel] ?? Send;
              return (
                <li
                  key={r.id}
                  className="flex min-w-0 flex-col gap-3 py-4 first:pt-0 last:pb-0"
                  data-channel={r.channel}
                >
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                      <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
                      {channelLabel(r.channel)}
                      <OutreachStatusBadge status={r.status} />
                    </span>
                    {canWorkLeads ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="tonal"
                          aria-label={`Log attempt: ${channelLabel(r.channel)}`}
                          onClick={() => setAttemptOn(r)}
                        >
                          Log attempt
                        </Button>
                        <OutreachStatusMenu record={r} name={business.name} />
                        <NextAttemptButton record={r} name={business.name} />
                      </span>
                    ) : null}
                  </div>
                  <OutreachFacts record={r} />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {canWorkLeads ? (
        <LogActivityDialog
          open={attemptOn !== null}
          onOpenChange={(o) => !o && setAttemptOn(null)}
          business={business}
          outreach={attemptOn}
        />
      ) : null}
    </Card>
  );
}
