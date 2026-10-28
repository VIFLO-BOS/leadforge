"use client";

import type {
  CandidateBusiness,
  DuplicateCandidate,
  MergeFieldChoice,
  MergeResponse,
} from "@leadforge/contracts";
import { GitMerge } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import {
  Banner,
  Button,
  ChoiceField,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioGroup,
  RadioGroupItem,
} from "@leadforge/ui";
import { isApiError } from "@/lib/api";
import {
  MERGE_FIELDS,
  MERGE_FIELD_LABELS,
  UNDO_RULE,
  candidateName,
  defaultChoice,
  mergeFieldValue,
  type MergeField,
} from "@/lib/dedup";
import { friendlyMessage, isForbidden } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { useMergeCandidate } from "@/lib/hooks/use-dedup";
import { sourceLabel } from "@/lib/labels";

export interface MergeDialogProps {
  candidate: DuplicateCandidate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged?: (res: MergeResponse) => void;
}

/** The earlier record survives by default (it keeps its id and links); ties keep business A. */
export function defaultSurvivor(businesses: CandidateBusiness[]): string {
  const [a, b] = businesses;
  if (!a || !b) return a?.id ?? "";
  if (a.createdAt && b.createdAt && b.createdAt < a.createdAt) return b.id;
  return a.id;
}

/** Field values that differ between the two (only those need a decision). */
function differs(a: CandidateBusiness, b: CandidateBusiness, field: MergeField): boolean {
  const va = mergeFieldValue(a, field);
  const vb = mergeFieldValue(b, field);
  return Boolean(va && vb && va.trim().toLowerCase() !== vb.trim().toLowerCase());
}

/**
 * Merge a candidate pair: choose the survivor (it keeps its id) and, for name, website and
 * location, which side's value to keep. Phones, emails, socials, categories, sources and source
 * records are combined. The request always states every field choice explicitly.
 */
export function MergeDialog({ candidate, open, onOpenChange, onMerged }: MergeDialogProps) {
  const baseId = useId();
  const merge = useMergeCandidate(candidate);
  const live = candidate.businesses.filter((b) => b.live);
  const [survivorId, setSurvivorId] = useState(() => defaultSurvivor(candidate.businesses));
  const survivor = candidate.businesses.find((b) => b.id === survivorId) ?? candidate.businesses[0];
  const other = candidate.businesses.find((b) => b.id !== survivorId) ?? candidate.businesses[1];
  const defaults = useMemo(
    () =>
      survivor
        ? (Object.fromEntries(MERGE_FIELDS.map((f) => [f, defaultChoice(survivor, f)])) as Record<
            MergeField,
            MergeFieldChoice
          >)
        : null,
    [survivor],
  );
  const [fields, setFields] = useState<Record<MergeField, MergeFieldChoice> | null>(defaults);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      setSurvivorId(defaultSurvivor(candidate.businesses));
      setError(null);
    }
  }, [open, candidate.businesses]);
  // A new survivor resets each field to the API's default for that survivor.
  useEffect(() => setFields(defaults), [defaults]);

  if (!survivor || !other || !fields) return null;
  const canMerge = live.length === 2;

  const submit = () => {
    setError(null);
    merge.mutate(
      { survivorId: survivor.id, fields },
      {
        onSuccess: (res) => {
          onOpenChange(false);
          onMerged?.(res);
        },
        onError: setError,
      },
    );
  };

  const conflict =
    isApiError(error) && (error.code === "MERGE_CONFLICT" || error.code === "CONFLICT");

  return (
    <Dialog open={open} onOpenChange={(o) => (merge.isPending ? undefined : onOpenChange(o))}>
      <DialogContent size="lg" data-testid="merge-dialog">
        <DialogHeader className="pr-12">
          <DialogTitle>Merge these businesses</DialogTitle>
          <DialogDescription>
            One record survives and keeps its ID; the other is merged into it and leaves the
            directory. You can undo the merge from the merge history.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-6 pb-2">
          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="mb-3 text-sm font-medium">Which record survives?</legend>
            <RadioGroup
              value={survivor.id}
              onValueChange={setSurvivorId}
              aria-label="Surviving record"
              className="gap-4"
            >
              {candidate.businesses.map((b, i) => (
                <ChoiceField
                  key={b.id}
                  id={`${baseId}-survivor-${b.id}`}
                  control={<RadioGroupItem value={b.id} disabled={!b.live} />}
                  label={
                    <span className="break-anywhere">
                      Business {i === 0 ? "A" : "B"}: {candidateName(b)}
                    </span>
                  }
                  description={
                    <span className="break-anywhere">
                      {[
                        b.sources.map((s) => sourceLabel(s)).join(", ") || "No sources",
                        b.createdAt ? `added ${formatDate(b.createdAt)}` : null,
                        b.live ? null : "no longer in the directory",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  }
                />
              ))}
            </RadioGroup>
          </fieldset>

          <div className="flex min-w-0 flex-col gap-4">
            <h3 className="text-sm font-medium">Values to keep</h3>
            {MERGE_FIELDS.map((field) => {
              const sv = mergeFieldValue(survivor, field);
              const ov = mergeFieldValue(other, field);
              const label = MERGE_FIELD_LABELS[field];
              if (!differs(survivor, other, field)) {
                return (
                  <div
                    key={field}
                    className="flex min-w-0 flex-col gap-0.5"
                    data-merge-field={field}
                  >
                    <span className="text-muted-foreground text-xs">{label}</span>
                    <span className="break-anywhere text-sm">
                      {sv ?? ov ?? (
                        <span className="text-muted-foreground">Neither record has one</span>
                      )}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {sv && ov
                        ? "Same on both records"
                        : sv
                          ? "Only the surviving record has one"
                          : ov
                            ? "Taken from the merged record"
                            : ""}
                    </span>
                  </div>
                );
              }
              return (
                <fieldset
                  key={field}
                  className="flex min-w-0 flex-col gap-2"
                  data-merge-field={field}
                >
                  <legend className="text-muted-foreground mb-2 text-xs">{label}</legend>
                  <RadioGroup
                    value={fields[field]}
                    onValueChange={(v) => setFields({ ...fields, [field]: v as MergeFieldChoice })}
                    aria-label={`${label} to keep`}
                  >
                    <ChoiceField
                      id={`${baseId}-${field}-survivor`}
                      control={<RadioGroupItem value="survivor" />}
                      label={<span className="break-anywhere">{sv}</span>}
                      description="From the surviving record"
                    />
                    <ChoiceField
                      id={`${baseId}-${field}-merged`}
                      control={<RadioGroupItem value="merged" />}
                      label={<span className="break-anywhere">{ov}</span>}
                      description={
                        field === "name"
                          ? "From the merged record"
                          : "From the merged record; the other value is kept as an alternative"
                      }
                    />
                  </RadioGroup>
                </fieldset>
              );
            })}
          </div>

          <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5 text-sm">
            <li>
              Phones, emails, social profiles, categories, sources and source records are combined.
            </li>
            <li>
              The merged record&apos;s provenance and verification history are listed with the
              survivor.
            </li>
            <li>If either record is suppressed, the survivor stays suppressed.</li>
            <li>{UNDO_RULE}</li>
          </ul>

          {!canMerge ? (
            <Banner
              tone="warning"
              title="One of these businesses is no longer in the directory"
              description="It was merged or deleted since this pair was proposed, so the pair cannot be merged."
            />
          ) : null}
          {error ? (
            <Banner
              tone="destructive"
              title={
                conflict
                  ? "This pair changed since the page loaded"
                  : isForbidden(error)
                    ? "Your role cannot merge businesses"
                    : "Could not merge"
              }
              description={
                conflict
                  ? "One of the businesses changed, was merged elsewhere, or the pair was already decided. The review has been refreshed; check it again before merging."
                  : friendlyMessage(error)
              }
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="text" onClick={() => onOpenChange(false)} disabled={merge.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={merge.isPending} disabled={!canMerge || conflict}>
            <GitMerge aria-hidden /> Merge businesses
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
