"use client";

import { CreateLeadListRequest, ROLE_LABELS, type LeadList } from "@leadforge/contracts";
import { useRouter } from "next/navigation";
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
import { isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf, validationDetails } from "@/lib/errors";
import { plural } from "@/lib/format";
import { useCreateList, useDeleteList, useUpdateList } from "@/lib/hooks/use-lists";
import { useMembers } from "@/lib/hooks/use-members";
import { usePermissions } from "@/lib/hooks/use-permissions";

/**
 * Create or edit a lead list: name (unique in the workspace), description and, for owners,
 * administrators and researchers, the owner. Validated with the contracts' request schema.
 */
export function ListFormDialog({
  open,
  onOpenChange,
  list,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this list; omit to create one. */
  list?: LeadList | null;
  onSaved?: (list: LeadList) => void;
}) {
  const id = useId();
  const { me } = useWorkspace();
  const { canManageAllLists } = usePermissions();
  const members = useMembers();
  const create = useCreateList();
  const update = useUpdateList();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState(me.user.id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>(null);
  const pending = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setName(list?.name ?? "");
    setDescription(list?.description ?? "");
    setOwner(list?.ownerUserId ?? me.user.id);
    setErrors({});
    setFailure(null);
  }, [open, list, me.user.id]);

  const save = () => {
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      ...(canManageAllLists ? { ownerUserId: owner } : {}),
    };
    const parsed = CreateLeadListRequest.safeParse(body);
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const i of parsed.error.issues) {
        const f = String(i.path[0] ?? "name");
        found[f] ??=
          f === "name"
            ? name.trim()
              ? "Use at most 80 characters."
              : "Name the list."
            : i.message;
      }
      setErrors(found);
      return;
    }
    setErrors({});
    setFailure(null);
    const onError = (err: unknown) => {
      if (isApiError(err) && err.code === "CONFLICT") {
        setErrors({ name: "A list with this name already exists. Choose another name." });
        return;
      }
      const d = validationDetails(err);
      if (Object.keys(d).length) setErrors(d);
      else setFailure(err);
    };
    const onSuccess = (saved: LeadList) => {
      onOpenChange(false);
      toast.success(list ? "List saved" : `List “${saved.name}” created`);
      onSaved?.(saved);
    };
    if (list) {
      const patch: Record<string, unknown> = {};
      if (body.name !== list.name) patch.name = body.name;
      if (body.description !== list.description) patch.description = body.description;
      if (canManageAllLists && owner !== list.ownerUserId) patch.ownerUserId = owner;
      if (!Object.keys(patch).length) {
        onOpenChange(false);
        return;
      }
      update.mutate({ id: list.id, body: patch }, { onSuccess, onError });
    } else {
      create.mutate(parsed.data, { onSuccess, onError });
    }
  };

  const activeMembers = (members.data?.data ?? []).filter((m) => m.status === "active");

  return (
    <Dialog open={open} onOpenChange={(o) => (pending ? undefined : onOpenChange(o))}>
      <DialogContent data-testid="list-form-dialog">
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <DialogHeader>
            <DialogTitle>{list ? "Edit list" : "New lead list"}</DialogTitle>
            <DialogDescription>
              A named group of businesses to work, assign or export together. Names are unique in
              the workspace.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5 pt-3 [--field-bg:var(--surface-elevated)]">
            <TextField
              id={`${id}-name`}
              label="Name"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.name}
              autoFocus
            />
            <TextAreaField
              id={`${id}-description`}
              label="Description (optional)"
              rows={3}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              error={errors.description}
            />
            {canManageAllLists ? (
              <FormField
                id={`${id}-owner`}
                label="Owner"
                error={errors.ownerUserId}
                hint="Sales representatives manage the lists they own."
              >
                <Select value={owner} onValueChange={setOwner}>
                  <SelectTrigger
                    id={`${id}-owner`}
                    className="h-12"
                    aria-describedby={[
                      `${id}-owner-hint`,
                      errors.ownerUserId ? `${id}-owner-error` : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {activeMembers.length === 0 ? (
                      <SelectItem value={me.user.id}>You</SelectItem>
                    ) : (
                      activeMembers.map((m) => (
                        <SelectItem key={m.userId} value={m.userId}>
                          {m.userId === me.user.id ? `${m.name} (you)` : m.name} ·{" "}
                          {ROLE_LABELS[m.role]}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </FormField>
            ) : null}
            {failure ? (
              <ErrorState
                title="Could not save the list"
                message={friendlyMessage(failure)}
                requestId={requestIdOf(failure)}
              />
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="text"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {list ? "Save list" : "Create list"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Deletes a list (its entries go; the businesses are not touched). */
export function DeleteListDialog({
  list,
  onOpenChange,
  redirect,
}: {
  list: LeadList | null;
  onOpenChange: (open: boolean) => void;
  /** Go back to /app/lists afterwards (from the list's own page). */
  redirect?: boolean;
}) {
  const router = useRouter();
  const remove = useDeleteList();
  return (
    <ConfirmDialog
      open={list !== null}
      onOpenChange={onOpenChange}
      destructive
      title={`Delete “${list?.name ?? "list"}”?`}
      description={`The list and its ${plural(list?.itemCount ?? 0, "entry", "entries")} are removed. The businesses, their leads and activity are not changed.`}
      confirmLabel="Delete list"
      loading={remove.isPending}
      onConfirm={() => {
        if (!list) return;
        remove.mutate(list.id, {
          onSuccess: () => {
            onOpenChange(false);
            toast.success(`List “${list.name}” deleted`);
            if (redirect) router.push("/app/lists");
          },
          onError: (err) => {
            onOpenChange(false);
            toast.error("Could not delete the list", { description: friendlyMessage(err) });
          },
        });
      }}
    />
  );
}
