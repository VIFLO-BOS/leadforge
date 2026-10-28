"use client";

import {
  UpdateLeadRequest,
  type Lead,
  type LeadPriority,
  type OrganizationProfile,
  type PipelineConfig,
} from "@leadforge/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
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
  ErrorState,
  FormField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextAreaField,
  TextField,
  toast,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch } from "@/lib/api";
import { formatMoney, parseMoneyInput, toMoneyInput } from "@/lib/billing";
import {
  PRIORITY_LABELS,
  fromLocalInput,
  leadBusinessName,
  stageLabel,
  toLocalInput,
} from "@/lib/crm";
import { friendlyMessage, requestIdOf, validationDetails } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { LeadChangedError, useUpdateLead } from "@/lib/hooks/use-pipeline";

export type LeadField = "priority" | "nextAction" | "wonValue" | "lostReason";

const NONE = "none";
const CURRENCIES = ["NGN", "USD", "EUR", "GBP", "GHS", "KES", "ZAR"] as const;

interface Values {
  priority: LeadPriority | typeof NONE;
  nextAction: string;
  wonValue: string;
  currency: string;
  lostReason: string;
}

function valuesFrom(lead: Lead, defaultCurrency: string): Values {
  const currency = lead.currency ?? defaultCurrency;
  return {
    priority: lead.priority ?? NONE,
    nextAction: lead.nextActionAt ? toLocalInput(lead.nextActionAt) : "",
    wonValue: lead.wonValueMinor !== null ? toMoneyInput(lead.wonValueMinor, currency) : "",
    currency,
    lostReason: lead.lostReason ?? "",
  };
}

/** Which fields the dialog offers: won value in a won stage, lost reason in a lost stage. */
export function leadFieldsFor(lead: Pick<Lead, "stageKind">): { won: boolean; lost: boolean } {
  return { won: lead.stageKind === "won", lost: lead.stageKind === "lost" };
}

/**
 * The PATCH body: only what changed. Clearing a value sends null. Returns the body and field
 * errors (keyed like the form) for anything the browser can check before sending.
 */
export function leadPatchBody(
  lead: Lead,
  v: Values,
  shown: { won: boolean; lost: boolean },
): {
  body: Omit<UpdateLeadRequest, "version">;
  errors: Partial<Record<LeadField | "currency", string>>;
} {
  const body: Omit<UpdateLeadRequest, "version"> = {};
  const errors: Partial<Record<LeadField | "currency", string>> = {};
  const priority = v.priority === NONE ? null : v.priority;
  if (priority !== lead.priority) body.priority = priority;

  const nextText = v.nextAction.trim();
  const next = nextText ? fromLocalInput(nextText) : null;
  if (nextText && !next) errors.nextAction = "Enter a date and time.";
  else {
    // Compared at minute precision, as the input shows it.
    const before = lead.nextActionAt ? toLocalInput(lead.nextActionAt) : "";
    if (before !== nextText) body.nextActionAt = next ?? null;
  }

  if (shown.won) {
    const text = v.wonValue.trim();
    const minor = text ? parseMoneyInput(text, v.currency) : null;
    if (text && minor === null)
      errors.wonValue = `Enter an amount in ${v.currency}, such as 250000 or 250000.50.`;
    else {
      if (minor !== lead.wonValueMinor) body.wonValueMinor = minor;
      if (minor !== null && (body.wonValueMinor !== undefined || v.currency !== lead.currency))
        body.currency = v.currency;
    }
  }
  if (shown.lost) {
    const reason = v.lostReason.trim();
    if (reason.length > 500) errors.lostReason = "Keep the reason under 500 characters.";
    else if ((reason || null) !== lead.lostReason) body.lostReason = reason || null;
  }
  return { body, errors };
}

/**
 * Lead details (PATCH /pipeline/leads/:id with `version`): priority, the next action, and the won
 * value or lost reason once the lead is closed. A stale version is not retried: the latest lead
 * is loaded, the dialog keeps the person's edits and explains, and the next Save uses it.
 */
export function LeadDetailsDialog({
  lead,
  config,
  open,
  onOpenChange,
  focus,
  onSaved,
}: {
  lead: Lead;
  config: PipelineConfig | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The field to focus first (the won/lost follow-up opens on its field). */
  focus?: LeadField;
  onSaved?: (lead: Lead) => void;
}) {
  const { org } = useWorkspace();
  const id = useId();
  const update = useUpdateLead();
  const profile = useQuery({
    queryKey: ["org", org.id, "profile"],
    queryFn: () => apiFetch<OrganizationProfile>("/organizations/current"),
    staleTime: 5 * 60_000,
    enabled: open,
  });
  const defaultCurrency = profile.data?.defaultCurrency ?? "NGN";
  const [base, setBase] = useState<Lead>(lead);
  const [v, setV] = useState<Values>(() => valuesFrom(lead, defaultCurrency));
  const [changed, setChanged] = useState<Lead | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const fieldRefs = useRef<Partial<Record<LeadField, HTMLElement | null>>>({});

  useEffect(() => {
    if (open) {
      setBase(lead);
      setV(valuesFrom(lead, defaultCurrency));
      setChanged(null);
      setSubmitted(false);
      update.reset();
    }
    // Reset only when the dialog opens.
  }, [open]);

  useEffect(() => {
    if (open && !lead.currency && !v.wonValue) setV((x) => ({ ...x, currency: defaultCurrency }));
  }, [defaultCurrency]);

  const shown = leadFieldsFor(base);
  const { body, errors } = leadPatchBody(base, v, shown);
  const server = validationDetails(update.error);
  const err = (f: LeadField) =>
    (submitted ? errors[f] : undefined) ??
    server[f === "nextAction" ? "nextActionAt" : f === "wonValue" ? "wonValueMinor" : f];
  const nothing = Object.keys(body).length === 0;
  const name = leadBusinessName(base);
  const generic =
    update.isError && !(update.error instanceof LeadChangedError) && !Object.keys(server).length
      ? update.error
      : null;

  const set = <K extends keyof Values>(k: K, value: Values[K]) =>
    setV((x) => ({ ...x, [k]: value }));

  const save = () => {
    setSubmitted(true);
    const firstBad = (["priority", "nextAction", "wonValue", "lostReason"] as LeadField[]).find(
      (f) => errors[f],
    );
    if (firstBad) {
      fieldRefs.current[firstBad]?.focus();
      return;
    }
    const parsed = UpdateLeadRequest.safeParse({ ...body, version: base.version });
    if (!parsed.success || nothing) return;
    update.mutate(
      { lead: base, body },
      {
        onSuccess: (saved) => {
          onOpenChange(false);
          toast.success("Lead details saved", { description: name });
          onSaved?.(saved);
        },
        onError: (e) => {
          if (e instanceof LeadChangedError) {
            setBase(e.lead);
            setChanged(e.lead);
          }
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (update.isPending ? undefined : onOpenChange(o))}>
      <DialogContent
        size="sm"
        data-testid="lead-details-dialog"
        onOpenAutoFocus={(e) => {
          const target = focus ? fieldRefs.current[focus] : null;
          if (target) {
            e.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Lead details</DialogTitle>
          <DialogDescription>
            {name} · {stageLabel(config, base.stageKey)}. Kept with the lead, apart from the
            business&apos;s details.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5 pb-2 [--field-bg:var(--surface-elevated)]">
          {changed ? (
            <Banner
              tone="warning"
              title="Someone changed this lead since it loaded"
              data-testid="lead-changed"
              description={`The latest version is loaded (it is now in ${stageLabel(config, changed.stageKey)}${changed.priority ? `, ${PRIORITY_LABELS[changed.priority].toLowerCase()}` : ""}). Your edits are kept; check them and save again.`}
            />
          ) : null}
          <FormField id={`${id}-priority`} label="Priority">
            <Select
              value={v.priority}
              onValueChange={(p) => set("priority", p as Values["priority"])}
            >
              <SelectTrigger
                id={`${id}-priority`}
                className="h-12"
                ref={(el) => {
                  fieldRefs.current.priority = el;
                }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No priority</SelectItem>
                <SelectItem value="high">{PRIORITY_LABELS.high}</SelectItem>
                <SelectItem value="medium">{PRIORITY_LABELS.medium}</SelectItem>
                <SelectItem value="low">{PRIORITY_LABELS.low}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <div className="flex min-w-0 flex-col gap-1.5">
            <TextField
              id={`${id}-next`}
              label="Next action"
              type="datetime-local"
              value={v.nextAction}
              onChange={(e) => set("nextAction", e.target.value)}
              hint={v.nextAction ? "Your local time." : "Not planned. Your local time."}
              error={err("nextAction")}
              ref={(el) => {
                fieldRefs.current.nextAction = el;
              }}
            />
            {v.nextAction ? (
              <Button
                variant="text"
                size="sm"
                className="self-start"
                onClick={() => set("nextAction", "")}
              >
                Clear next action
              </Button>
            ) : null}
          </div>
          {shown.won ? (
            <div className="grid min-w-0 grid-cols-1 gap-3 min-[360px]:grid-cols-[minmax(0,1fr)_7rem]">
              <TextField
                id={`${id}-won`}
                label="Won value"
                inputMode="decimal"
                autoComplete="off"
                value={v.wonValue}
                onChange={(e) => set("wonValue", e.target.value)}
                hint={
                  v.wonValue.trim() && parseMoneyInput(v.wonValue, v.currency) !== null
                    ? formatMoney(parseMoneyInput(v.wonValue, v.currency)!, v.currency)
                    : "What the deal is worth. Leave empty if unknown."
                }
                error={err("wonValue")}
                ref={(el) => {
                  fieldRefs.current.wonValue = el;
                }}
              />
              <FormField id={`${id}-currency`} label="Currency" error={server.currency}>
                <Select value={v.currency} onValueChange={(c) => set("currency", c)}>
                  <SelectTrigger id={`${id}-currency`} className="h-12" aria-label="Currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[...new Set([v.currency, ...CURRENCIES])].map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>
          ) : null}
          {shown.lost ? (
            <TextAreaField
              id={`${id}-lost`}
              label="Lost reason"
              rows={3}
              value={v.lostReason}
              onChange={(e) => set("lostReason", e.target.value)}
              hint="Why the lead was lost, for the team and the reports."
              error={err("lostReason")}
              ref={(el) => {
                fieldRefs.current.lostReason = el;
              }}
            />
          ) : null}
          {!shown.won && !shown.lost ? (
            <p className="text-muted-foreground text-xs">
              The won value or the lost reason can be recorded once the lead is in a Won or Lost
              stage.
            </p>
          ) : null}
          {base.updatedAt ? (
            <p className="text-muted-foreground text-xs">
              Last changed {formatDateTime(base.updatedAt)}.
            </p>
          ) : null}
          {generic ? (
            <ErrorState
              title="Could not save the lead"
              message={friendlyMessage(generic)}
              requestId={requestIdOf(generic)}
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="text" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Cancel
          </Button>
          <Button onClick={save} loading={update.isPending} disabled={nothing}>
            Save details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
