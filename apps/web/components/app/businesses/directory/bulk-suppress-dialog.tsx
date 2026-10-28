"use client";

import {
  BULK_SUPPRESS_MAX,
  BulkSuppressRequest,
  type BulkSuppressResult,
  type SuppressionScope,
} from "@leadforge/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleSlash, CircleX, EyeOff, SearchX } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  Button,
  ChoiceField,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Progress,
  RadioGroup,
  RadioGroupItem,
  StatusIndicator,
  TextAreaField,
  toast,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch } from "@/lib/api";
import { friendlyMessage } from "@/lib/errors";
import { formatNumber, plural } from "@/lib/format";
import { invalidateBusinessData } from "@/lib/hooks/use-businesses";
import { queryKeys } from "@/lib/query-keys";

const SCOPES: { value: SuppressionScope; label: string; description: string }[] = [
  { value: "business", label: "These businesses", description: "Only the selected records." },
  {
    value: "domain",
    label: "Their website domains",
    description: "Every business on the same domain, now and in future imports.",
  },
  {
    value: "phone",
    label: "Their primary phone numbers",
    description: "Every business with the same number.",
  },
  {
    value: "email",
    label: "Their primary email addresses",
    description: "Every business with the same address.",
  },
];

type Summary = BulkSuppressResult["summary"];

function addSummaries(a: Summary, b: Summary): Summary {
  return {
    requested: a.requested + b.requested,
    suppressed: a.suppressed + b.suppressed,
    alreadySuppressed: a.alreadySuppressed + b.alreadySuppressed,
    notFound: a.notFound + b.notFound,
    noValue: a.noValue + b.noValue,
    failed: a.failed + b.failed,
    businessesAffected: a.businessesAffected + b.businessesAffected,
  };
}

const EMPTY: Summary = {
  requested: 0,
  suppressed: 0,
  alreadySuppressed: 0,
  notFound: 0,
  noValue: 0,
  failed: 0,
  businessesAffected: 0,
};

export interface BulkSuppressDialogProps {
  ids: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the run with the ids that are now suppressed (newly or already). */
  onDone: (suppressed: string[]) => void;
}

/**
 * Bulk suppression through POST /businesses/suppress (up to 100 ids per request; larger
 * selections are sent in batches): one scope and one reason for every selected business, gated
 * by a typed phrase with the count, then the per-outcome counts the API reports.
 */
export function BulkSuppressDialog({ ids, open, onOpenChange, onDone }: BulkSuppressDialogProps) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  const baseId = useId();
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<SuppressionScope>("business");
  const [running, setRunning] = useState(false);
  const [sent, setSent] = useState(0);
  const [result, setResult] = useState<{ summary: Summary; failures: string[] } | null>(null);

  useEffect(() => {
    if (!open) {
      setReason("");
      setScope("business");
      setSent(0);
    }
  }, [open]);

  const count = ids.length;
  const parsed = BulkSuppressRequest.safeParse({
    ids: ids.slice(0, BULK_SUPPRESS_MAX),
    scope,
    reason,
  });
  const reasonIssue = parsed.success
    ? undefined
    : parsed.error.issues.find((i) => i.path[0] === "reason");
  const reasonError = reason.length > 0 ? reasonIssue?.message : undefined;

  const run = async () => {
    if (!parsed.success) return;
    setRunning(true);
    setSent(0);
    let summary = EMPTY;
    const done: string[] = [];
    const failures: string[] = [];
    for (let i = 0; i < ids.length; i += BULK_SUPPRESS_MAX) {
      const batch = ids.slice(i, i + BULK_SUPPRESS_MAX);
      try {
        const res = await apiFetch<BulkSuppressResult>("/businesses/suppress", {
          method: "POST",
          body: { ids: batch, scope, reason: parsed.data.reason },
        });
        summary = addSummaries(summary, res.summary);
        for (const r of res.results) {
          if (r.outcome === "suppressed" || r.outcome === "already_suppressed") done.push(r.id);
          else if (r.outcome === "failed" && r.message) failures.push(r.message);
        }
      } catch (err) {
        summary = addSummaries(summary, {
          ...EMPTY,
          requested: batch.length,
          failed: batch.length,
        });
        failures.push(friendlyMessage(err));
      }
      setSent(Math.min(ids.length, i + batch.length));
    }
    setRunning(false);
    // Suppression by domain, phone or email can flag businesses outside the selection.
    void queryClient.invalidateQueries({ queryKey: queryKeys.businesses.all(org.id) });
    invalidateBusinessData(queryClient, org.id);
    onDone(done);
    onOpenChange(false);
    setResult({ summary, failures });
    if (summary.failed === 0) {
      toast.success(
        `Suppressed ${plural(summary.suppressed + summary.alreadySuppressed, "business", "businesses")}`,
      );
    }
  };

  const s = result?.summary;
  return (
    <>
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title={`Suppress ${plural(count, "business", "businesses")}?`}
        description="Suppressed businesses are hidden from the directory by default, never exported, never fetched for analysis, and skipped by future imports that match them. You can remove a suppression from the business's page."
        destructive
        confirmPhrase={`SUPPRESS ${count}`}
        confirmLabel={`Suppress ${count}`}
        confirmDisabled={!parsed.success}
        loading={running}
        onConfirm={run}
      >
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">What to suppress</legend>
          <RadioGroup
            value={scope}
            onValueChange={(v) => setScope(v as SuppressionScope)}
            aria-label="Suppression scope"
          >
            {SCOPES.map((o) => (
              <ChoiceField
                key={o.value}
                id={`${baseId}-${o.value}`}
                control={<RadioGroupItem value={o.value} disabled={running} />}
                label={o.label}
                description={o.description}
              />
            ))}
          </RadioGroup>
        </fieldset>
        <TextAreaField
          id="bulk-suppress-reason"
          label="Reason"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          disabled={running}
          error={reasonError}
          hint="Recorded with each suppression and in the audit log, for example “Asked not to be contacted”."
          containerClassName="[--field-bg:var(--surface-elevated)]"
          className="min-h-[96px]"
        />
        {count > BULK_SUPPRESS_MAX ? (
          <p className="text-muted-foreground text-xs">Sent in batches of {BULK_SUPPRESS_MAX}.</p>
        ) : null}
        {running ? (
          <Progress
            label="Suppressing businesses"
            value={sent}
            max={count}
            valueText={`${sent} of ${count} sent`}
            showLabel
          />
        ) : null}
      </ConfirmDialog>

      <Dialog open={result !== null} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent size="sm" data-testid="bulk-suppress-result">
          <DialogHeader className="pr-12">
            <DialogTitle>Suppression results</DialogTitle>
            <DialogDescription>
              {s
                ? `${plural(s.requested, "business", "businesses")} requested. ${plural(s.businessesAffected, "business is", "businesses are")} now flagged, including any sharing a suppressed value.`
                : null}
            </DialogDescription>
          </DialogHeader>
          {s ? (
            <DialogBody className="flex flex-col gap-3 pb-2">
              <ul className="flex min-w-0 flex-col gap-2 text-sm">
                <li>
                  <StatusIndicator
                    tone="success"
                    icon={CircleCheck}
                    label={`Suppressed: ${formatNumber(s.suppressed)}`}
                  />
                </li>
                <li>
                  <StatusIndicator
                    tone="neutral"
                    icon={EyeOff}
                    label={`Already suppressed: ${formatNumber(s.alreadySuppressed)}`}
                  />
                </li>
                <li>
                  <StatusIndicator
                    tone="neutral"
                    icon={CircleSlash}
                    label={`No value for this scope: ${formatNumber(s.noValue)}`}
                  />
                </li>
                <li>
                  <StatusIndicator
                    tone="neutral"
                    icon={SearchX}
                    label={`Not found: ${formatNumber(s.notFound)}`}
                  />
                </li>
                <li>
                  <StatusIndicator
                    tone={s.failed ? "destructive" : "neutral"}
                    icon={CircleX}
                    label={`Failed: ${formatNumber(s.failed)}`}
                  />
                </li>
              </ul>
              {result?.failures.length ? (
                <p className="text-destructive break-anywhere text-xs">{result.failures[0]}</p>
              ) : null}
            </DialogBody>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setResult(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
