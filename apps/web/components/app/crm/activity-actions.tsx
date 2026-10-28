"use client";

import {
  CRM_LIMITS,
  UpdateActivityRequest,
  type Activity,
  type ActivityOutcome,
  type LoggableActivityType,
} from "@leadforge/contracts";
import { EllipsisVertical, Pencil, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
import {
  activityNoun,
  activityTypeLabel,
  canEditActivity,
  fromLocalInput,
  outcomeError,
  outcomeLabel,
  outcomesFor,
  toLocalInput,
} from "@/lib/crm";
import { friendlyMessage, requestIdOf, validationDetails } from "@/lib/errors";
import { useDeleteActivity, useUpdateActivity } from "@/lib/hooks/use-activities";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { NO_OUTCOME } from "./log-activity-dialog";

/** Whether the signed-in member may edit or delete this activity (author, owner or admin). */
export function useCanEditActivity() {
  const { me } = useWorkspace();
  const { role, canWorkLeads } = usePermissions();
  return (a: Activity) => canEditActivity(a, { userId: me.user.id, role, canWork: canWorkLeads });
}

/**
 * Edit and Delete for one activity, in a menu. Offered to its author and to owners and
 * administrators; stage changes and assignments are written by the system and have neither.
 */
export function ActivityActions({ activity, label }: { activity: Activity; label: string }) {
  const allowed = useCanEditActivity()(activity);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remove = useDeleteActivity();
  if (!allowed) return null;
  const type = activityNoun(activity.type);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${label}`}>
            <EllipsisVertical aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil aria-hidden /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem destructive onSelect={() => setDeleting(true)}>
            <Trash2 aria-hidden /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditActivityDialog activity={activity} open={editing} onOpenChange={setEditing} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        destructive
        title={`Delete this ${type}?`}
        description="It is removed from the timeline and the activity lists. The deletion and its content are kept in the audit log."
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(activity.id, {
            onSuccess: () => {
              setDeleting(false);
              toast.success(`${activityTypeLabel(activity.type)} deleted`);
            },
            onError: (err) => {
              setDeleting(false);
              toast.error("Could not delete the activity", { description: friendlyMessage(err) });
            },
          })
        }
      />
    </>
  );
}

/** PATCH /activities/:id: text, outcome (from the type's own list) and time. */
export function EditActivityDialog({
  activity,
  open,
  onOpenChange,
}: {
  activity: Activity;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const update = useUpdateActivity();
  const type = activity.type as LoggableActivityType;
  const [body, setBody] = useState(activity.body ?? "");
  const [outcome, setOutcome] = useState(activity.outcome ?? NO_OUTCOME);
  const [when, setWhen] = useState(toLocalInput(activity.occurredAt));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setBody(activity.body ?? "");
    setOutcome(activity.outcome ?? NO_OUTCOME);
    setWhen(toLocalInput(activity.occurredAt));
    setErrors({});
    setFailure(null);
  }, [open, activity]);

  const save = () => {
    const next: Record<string, unknown> = {};
    const newBody = body.trim() || null;
    if (newBody !== (activity.body ?? null)) next.body = newBody;
    const newOutcome = outcome === NO_OUTCOME ? null : outcome;
    if (newOutcome !== activity.outcome) next.outcome = newOutcome;
    const at = fromLocalInput(when);
    if (at && at.slice(0, 16) !== activity.occurredAt.slice(0, 16)) next.occurredAt = at;
    const found: Record<string, string> = {};
    if (type === "note" && !newBody) found.body = "A note needs text.";
    const oe = outcomeError(type, newOutcome ?? undefined);
    if (oe) found.outcome = oe;
    if (!at) found.occurredAt = "Enter a valid date and time.";
    const parsed = UpdateActivityRequest.safeParse(next);
    if (!parsed.success && Object.keys(next).length === 0) {
      onOpenChange(false);
      return;
    }
    if (!parsed.success)
      for (const i of parsed.error.issues) found[String(i.path[0] ?? "body")] ??= i.message;
    setErrors(found);
    if (Object.keys(found).length) return;
    setFailure(null);
    update.mutate(
      { id: activity.id, body: parsed.data! },
      {
        onSuccess: () => {
          onOpenChange(false);
          toast.success(`${activityTypeLabel(activity.type)} updated`);
        },
        onError: (err) => {
          const d = validationDetails(err);
          if (Object.keys(d).length) setErrors(d);
          else setFailure(err);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (update.isPending ? undefined : onOpenChange(o))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {activityNoun(activity.type)}</DialogTitle>
          <DialogDescription>
            Edits are recorded in the audit log with the previous content.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5 pt-3 [--field-bg:var(--surface-elevated)]">
          {type !== "note" ? (
            <FormField id={`${id}-outcome`} label="Outcome" error={errors.outcome}>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger
                  id={`${id}-outcome`}
                  className="h-12"
                  aria-invalid={errors.outcome ? true : undefined}
                  aria-describedby={errors.outcome ? `${id}-outcome-error` : undefined}
                >
                  <SelectValue placeholder="Choose an outcome" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OUTCOME}>No outcome recorded</SelectItem>
                  {outcomesFor(type).map((o: ActivityOutcome) => (
                    <SelectItem key={o} value={o}>
                      {outcomeLabel(o)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}
          <TextAreaField
            id={`${id}-body`}
            label={type === "note" ? "Note" : "Notes"}
            rows={4}
            maxLength={CRM_LIMITS.activityBodyMax}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            error={errors.body}
          />
          <TextField
            id={`${id}-when`}
            label="When"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            error={errors.occurredAt}
          />
          {failure ? (
            <ErrorState
              title="Could not save the changes"
              message={friendlyMessage(failure)}
              requestId={requestIdOf(failure)}
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="text" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Cancel
          </Button>
          <Button onClick={save} loading={update.isPending}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
