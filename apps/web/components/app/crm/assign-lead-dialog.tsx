"use client";

import type { Lead } from "@leadforge/contracts";
import { ROLE_LABELS } from "@leadforge/contracts";
import { useEffect, useId, useState } from "react";
import {
  Avatar,
  AvatarFallback,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  initials,
  toast,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { useAssignableMembers } from "@/lib/hooks/use-members";
import { useAssignLead, useCreateLead } from "@/lib/hooks/use-pipeline";

const UNASSIGNED = "__unassigned";

/**
 * Assigns a lead to a member who can work leads (owners, administrators and sales
 * representatives; the API answers 422 INVALID_ASSIGNEE otherwise). With no lead yet, saving adds
 * the business to the pipeline's entry stage with that owner. Assigning notifies the assignee.
 */
export function AssignLeadDialog({
  open,
  onOpenChange,
  lead,
  businessId,
  businessName,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The lead to assign; null adds the business to the pipeline. */
  lead: Lead | null;
  businessId: string;
  businessName: string;
  onDone?: (lead: Lead) => void;
}) {
  const { me } = useWorkspace();
  const members = useAssignableMembers();
  const assign = useAssignLead();
  const create = useCreateLead();
  const groupId = useId();
  const current = lead?.assignedToUserId ?? UNASSIGNED;
  const [value, setValue] = useState<string>(current);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (open) {
      setValue(lead?.assignedToUserId ?? UNASSIGNED);
      setError(null);
    }
  }, [open, lead?.assignedToUserId]);

  const pending = assign.isPending || create.isPending;
  const invalidAssignee = isApiError(error) && error.code === "INVALID_ASSIGNEE";

  const save = () => {
    const assignedToUserId = value === UNASSIGNED ? null : value;
    const name =
      assignedToUserId === null
        ? null
        : assignedToUserId === me.user.id
          ? "you"
          : (members.assignable.find((m) => m.userId === assignedToUserId)?.name ?? "the member");
    const done = (l: Lead) => {
      onOpenChange(false);
      toast.success(
        name ? `Assigned ${businessName} to ${name}` : `${businessName} is now unassigned`,
        name && assignedToUserId !== me.user.id
          ? {
              description:
                "They get an in-app notification, and an email unless they turned it off.",
            }
          : undefined,
      );
      onDone?.(l);
    };
    const fail = (err: unknown) => {
      setError(err);
      if (isApiError(err) && err.code === "INVALID_ASSIGNEE") void members.refetch();
    };
    setError(null);
    if (lead) assign.mutate({ lead, assignedToUserId }, { onSuccess: done, onError: fail });
    else create.mutate({ businessId, assignedToUserId }, { onSuccess: done, onError: fail });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (pending ? undefined : onOpenChange(o))}>
      <DialogContent size="sm" data-testid="assign-dialog">
        <DialogHeader>
          <DialogTitle>{lead ? "Assign lead" : "Add to pipeline and assign"}</DialogTitle>
          <DialogDescription>
            {lead
              ? `Who works ${businessName}? Leads go to owners, administrators and sales representatives.`
              : `${businessName} is added to the first pipeline stage with the owner you choose.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4 pb-2">
          {members.isPending ? (
            <div
              role="status"
              aria-busy="true"
              aria-label="Loading members"
              className="flex flex-col gap-2"
            >
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : members.isError ? (
            <ErrorState
              title="Could not load team members"
              message={friendlyMessage(members.error)}
              requestId={requestIdOf(members.error)}
              onRetry={() => void members.refetch()}
            />
          ) : (
            <div className="flex min-w-0 flex-col gap-2">
              <p id={`${groupId}-label`} className="text-sm font-medium">
                Owner
              </p>
              <RadioGroup
                value={value}
                onValueChange={setValue}
                aria-labelledby={`${groupId}-label`}
                aria-describedby={invalidAssignee ? `${groupId}-error` : undefined}
                aria-invalid={invalidAssignee || undefined}
                className="max-h-[50vh] gap-0 overflow-y-auto"
              >
                <MemberOption
                  id={`${groupId}-none`}
                  value={UNASSIGNED}
                  name="Unassigned"
                  detail="Nobody owns this lead"
                />
                {members.assignable.map((m) => (
                  <MemberOption
                    key={m.userId}
                    id={`${groupId}-${m.userId}`}
                    value={m.userId}
                    name={m.userId === me.user.id ? `${m.name} (you)` : m.name}
                    detail={ROLE_LABELS[m.role]}
                    avatar
                  />
                ))}
              </RadioGroup>
              {members.assignable.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No active owner, administrator or sales representative can take leads yet. Invite
                  one from Team.
                </p>
              ) : null}
            </div>
          )}
          {error ? (
            invalidAssignee ? (
              <p id={`${groupId}-error`} role="alert" className="text-destructive text-sm">
                {friendlyMessage(error)} The list was refreshed; choose someone else.
              </p>
            ) : (
              <ErrorState
                title="Could not assign the lead"
                message={friendlyMessage(error)}
                requestId={requestIdOf(error)}
              />
            )
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="text" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={save}
            loading={pending}
            disabled={members.isPending || members.isError || (lead !== null && value === current)}
          >
            {lead ? "Save owner" : "Add to pipeline"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemberOption({
  id,
  value,
  name,
  detail,
  avatar,
}: {
  id: string;
  value: string;
  name: string;
  detail: string;
  avatar?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className="state-layer transition-ui flex min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-2"
    >
      <RadioGroupItem id={id} value={value} />
      {avatar ? (
        <Avatar size="sm" aria-hidden>
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
      ) : null}
      <span className="flex min-w-0 flex-col">
        <span className="break-anywhere text-sm">{name}</span>
        <span className="text-muted-foreground text-xs">{detail}</span>
      </span>
    </label>
  );
}
