"use client";

import {
  ROLE_LABELS,
  type BulkAction,
  type BulkOperationRequest,
  type BulkPreview,
  type BulkSelection,
} from "@leadforge/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  Banner,
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  FormField,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusIndicator,
  toast,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import {
  ListPicker,
  NEW_LIST,
  newListNameError,
  useResolveList,
} from "@/components/app/crm/list-picker";
import { isApiError } from "@/lib/api";
import {
  BULK_CAP,
  BULK_PHRASE_THRESHOLD,
  bulkActionLabel,
  bulkLimitDetails,
  bulkOutcomeMeta,
  bulkPhrase,
  newIdempotencyKey,
} from "@/lib/bulk";
import { activeStages } from "@/lib/crm";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatNumber, plural } from "@/lib/format";
import { useBulkPreview, useCreateBulkOperation } from "@/lib/hooks/use-bulk";
import { useAssignableMembers } from "@/lib/hooks/use-members";
import { usePipelineConfig } from "@/lib/hooks/use-pipeline";

const UNASSIGNED = "__unassigned";

type Phase = "configure" | "preview" | "confirm";

const ACTION_COPY: Record<BulkAction, { title: string; verb: string }> = {
  add_to_list: { title: "Add to a list", verb: "Add" },
  remove_from_list: { title: "Remove from a list", verb: "Remove" },
  assign: { title: "Assign leads", verb: "Assign" },
  move_stage: { title: "Move to a pipeline stage", verb: "Move" },
};

/** "The 240 businesses that match the filters", "12 selected businesses". */
export function selectionPhrase(selection: BulkSelection, count: number | null): string {
  if (selection.ids)
    return plural(selection.ids.length, "selected business", "selected businesses");
  return count !== null
    ? `the ${plural(count, "business", "businesses")} that match the filters`
    : "the businesses that match the filters";
}

/**
 * A bulk operation on directory businesses, in three steps: choose (list, owner or stage), preview
 * the counts the API computes without writing anything, then confirm (a typed phrase from
 * BULK_PHRASE_THRESHOLD businesses). Confirming creates the operation with an Idempotency-Key kept
 * for retries of the same confirmation, and opens its job page, which shows progress and the
 * per-business results.
 */
export function BulkActionDialog({
  open,
  onOpenChange,
  action,
  selection,
  count,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: BulkAction;
  selection: BulkSelection;
  /** Matching businesses when known (the directory total), for the wording before the preview. */
  count: number | null;
  onCreated?: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const { me } = useWorkspace();
  const config = usePipelineConfig();
  const members = useAssignableMembers();
  const preview = useBulkPreview();
  const create = useCreateBulkOperation();
  const { resolve, create: createList } = useResolveList();
  const [phase, setPhase] = useState<Phase>("configure");
  const [listValue, setListValue] = useState("");
  const [newName, setNewName] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const [assignee, setAssignee] = useState("");
  const [stageKey, setStageKey] = useState("");
  const [request, setRequest] = useState<BulkOperationRequest | null>(null);
  const [result, setResult] = useState<BulkPreview | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const key = useRef<string>("");

  useEffect(() => {
    if (!open) return;
    setPhase("configure");
    setListValue("");
    setNewName("");
    setNameError(undefined);
    setAssignee("");
    setStageKey("");
    setRequest(null);
    setResult(null);
    setProblem(null);
    preview.reset();
    create.reset();
  }, [open]);

  const copy = ACTION_COPY[action];
  const what = selectionPhrase(selection, count);
  const chosen =
    action === "assign"
      ? Boolean(assignee)
      : action === "move_stage"
        ? Boolean(stageKey)
        : Boolean(listValue);
  const busy = preview.isPending || createList.isPending;

  const targetText = (): string => {
    if (action === "assign") {
      if (assignee === UNASSIGNED) return "nobody (unassign)";
      if (assignee === me.user.id) return "you";
      return members.assignable.find((m) => m.userId === assignee)?.name ?? "the member";
    }
    if (action === "move_stage")
      return activeStages(config.data).find((s) => s.key === stageKey)?.label ?? stageKey;
    return listValue === NEW_LIST ? `“${newName.trim()}”` : "the list";
  };

  const runPreview = async () => {
    setProblem(null);
    setNameError(undefined);
    let req: BulkOperationRequest;
    if (action === "add_to_list" || action === "remove_from_list") {
      if (listValue === NEW_LIST && !newName.trim()) {
        setNameError("Name the new list.");
        return;
      }
      let listId: string;
      try {
        listId = await resolve(listValue, newName);
      } catch (err) {
        const msg = newListNameError(listValue, newName, err);
        if (msg) setNameError(msg);
        else setProblem(err);
        return;
      }
      setListValue(listId);
      req = { action, listId, selection };
    } else if (action === "assign") {
      req = { action, assignedToUserId: assignee === UNASSIGNED ? null : assignee, selection };
    } else {
      req = { action, stageKey, selection };
    }
    setRequest(req);
    preview.mutate(req, {
      onSuccess: (p) => {
        setResult(p);
        setPhase("preview");
      },
      onError: setProblem,
    });
  };

  const confirm = () => {
    if (!request) return;
    create.mutate(
      { body: request, key: key.current },
      {
        onSuccess: (op) => {
          setPhase("configure");
          onOpenChange(false);
          onCreated?.();
          toast.success(`${bulkActionLabel(action)} started`, {
            description: `${plural(op.progress.total, "business", "businesses")}. Follow the progress on the job page.`,
          });
          router.push(`/app/jobs/bulk/${op.id}`);
        },
        onError: (err) => {
          if (isApiError(err) && err.code === "CONFLICT") key.current = newIdempotencyKey("bulk");
          setProblem(err);
          setPhase("preview");
        },
      },
    );
  };

  const limit = bulkLimitDetails(problem);
  const listLabel =
    action === "remove_from_list" ? "List to remove them from" : "List to add them to";

  const breakdown = result?.breakdown.filter((b) => b.count > 0) ?? [];

  return (
    <>
      <Dialog
        open={open && phase !== "confirm"}
        onOpenChange={(o) => {
          if (busy) return;
          if (!o) onOpenChange(false);
        }}
      >
        <DialogContent data-testid="bulk-action-dialog">
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>
              {phase === "preview" ? "Preview: nothing has changed yet." : `For ${what}.`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4 pt-3 [--field-bg:var(--surface-elevated)]">
            {phase === "configure" ? (
              action === "add_to_list" || action === "remove_from_list" ? (
                <ListPicker
                  label={listLabel}
                  value={listValue}
                  onChange={setListValue}
                  newName={newName}
                  onNewNameChange={setNewName}
                  newNameError={nameError}
                  allowCreate={action === "add_to_list"}
                />
              ) : action === "assign" ? (
                members.isPending ? (
                  <div role="status" aria-busy="true" aria-label="Loading members">
                    <Skeleton className="h-24" />
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-col gap-2">
                    <p id={`${id}-owner`} className="text-sm font-medium">
                      Owner
                    </p>
                    <RadioGroup
                      value={assignee}
                      onValueChange={setAssignee}
                      aria-labelledby={`${id}-owner`}
                      className="max-h-64 gap-0 overflow-y-auto"
                    >
                      {[
                        ...members.assignable.map((m) => ({
                          value: m.userId,
                          name: m.userId === me.user.id ? `${m.name} (you)` : m.name,
                          detail: ROLE_LABELS[m.role],
                        })),
                        {
                          value: UNASSIGNED,
                          name: "Unassigned",
                          detail: "Remove the current owner",
                        },
                      ].map((o) => (
                        <label
                          key={o.value}
                          htmlFor={`${id}-${o.value}`}
                          className="state-layer transition-ui flex min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-2"
                        >
                          <RadioGroupItem id={`${id}-${o.value}`} value={o.value} />
                          <span className="flex min-w-0 flex-col">
                            <span className="break-anywhere text-sm">{o.name}</span>
                            <span className="text-muted-foreground text-xs">{o.detail}</span>
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                    <p className="text-muted-foreground text-xs">
                      Businesses not in the pipeline yet are added to its first stage. The new owner
                      is notified once for the whole operation.
                    </p>
                  </div>
                )
              ) : (
                <FormField
                  id={`${id}-stage`}
                  label="Stage"
                  hint="Only businesses already in the pipeline move."
                >
                  <Select value={stageKey} onValueChange={setStageKey}>
                    <SelectTrigger
                      id={`${id}-stage`}
                      className="h-12"
                      aria-describedby={`${id}-stage-hint`}
                    >
                      <SelectValue placeholder="Choose a stage" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeStages(config.data).map((s) => (
                        <SelectItem key={s.key} value={s.key}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )
            ) : result ? (
              <div className="flex min-w-0 flex-col gap-4" data-testid="bulk-preview">
                <p className="text-sm">
                  <strong className="font-medium">
                    {plural(result.matched, "business matches", "businesses match")}
                  </strong>
                  {" · "}
                  <strong className="font-medium" data-testid="bulk-will-change">
                    {formatNumber(result.willChange)} will change
                  </strong>
                </p>
                {breakdown.length ? (
                  <ul className="flex min-w-0 flex-col gap-2" aria-label="Expected outcomes">
                    {breakdown.map((b) => {
                      const meta = bulkOutcomeMeta(b.outcome);
                      return (
                        <li
                          key={b.outcome}
                          className="flex min-w-0 items-start justify-between gap-3"
                        >
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <StatusIndicator tone={meta.tone} label={meta.label} size="sm" />
                            <span className="text-muted-foreground text-xs">
                              {meta.description}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm tabular-nums">
                            {formatNumber(b.count)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {result.overCap ? (
                  <Banner
                    tone="destructive"
                    title="Too many businesses for one operation"
                    description={`Bulk operations are limited to ${formatNumber(result.cap)} businesses and ${formatNumber(result.matched)} match. Narrow the filters, then try again.`}
                  />
                ) : result.willChange === 0 ? (
                  <Banner
                    tone="info"
                    title="Nothing would change"
                    description="Every matching business is already in that state or would be skipped."
                  />
                ) : null}
              </div>
            ) : null}
            {limit ? (
              <Banner
                tone="destructive"
                title="Too many businesses for one operation"
                description={`Bulk operations are limited to ${formatNumber(limit.cap)} businesses${limit.matched !== null ? ` and ${formatNumber(limit.matched)} match` : ""}. Narrow the filters or select fewer.`}
              />
            ) : problem ? (
              <ErrorState
                title={
                  phase === "preview"
                    ? "Could not start the operation"
                    : "Could not preview the changes"
                }
                message={friendlyMessage(problem)}
                requestId={requestIdOf(problem)}
              />
            ) : null}
          </DialogBody>
          <DialogFooter>
            {phase === "preview" ? (
              <Button variant="text" onClick={() => setPhase("configure")}>
                Back
              </Button>
            ) : (
              <Button variant="text" disabled={busy} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            )}
            {phase === "configure" ? (
              <Button disabled={!chosen} loading={busy} onClick={() => void runPreview()}>
                Preview changes
              </Button>
            ) : (
              <Button
                disabled={!result || result.overCap || result.willChange === 0}
                onClick={() => {
                  key.current = newIdempotencyKey("bulk");
                  setProblem(null);
                  setPhase("confirm");
                }}
              >
                Continue
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={open && phase === "confirm"}
        onOpenChange={(o) => !o && setPhase("preview")}
        title={`${copy.verb} ${plural(result?.matched ?? 0, "business", "businesses")}?`}
        description={`${bulkActionLabel(action)}: ${targetText()}. ${formatNumber(result?.willChange ?? 0)} will change; the rest are skipped or already done. It runs in the background and its page shows each business's result.`}
        confirmLabel={`${copy.verb} ${formatNumber(result?.matched ?? 0)}`}
        confirmPhrase={
          result && result.matched >= BULK_PHRASE_THRESHOLD
            ? bulkPhrase(action, result.matched)
            : undefined
        }
        loading={create.isPending}
        onConfirm={confirm}
      >
        {result && result.matched > BULK_CAP ? null : (
          <p className="text-muted-foreground text-sm">
            The selection is fixed now: businesses added to the directory later are not included,
            and retrying never applies it twice.
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
