"use client";

import type { LeadList, ListItemsResult } from "@leadforge/contracts";
import { ListPlus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
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
  SearchField,
  Skeleton,
  TextField,
  toast,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { plural } from "@/lib/format";
import { useCreateList, useLeadLists, useListItemsChange } from "@/lib/hooks/use-lists";
import { usePermissions } from "@/lib/hooks/use-permissions";

export const NEW_LIST = "__new";

/**
 * Lists the member can add to (all lists for managers; their own for sales representatives),
 * searchable by name, with a "New list" choice. `memberOf` marks lists that already hold the
 * business.
 */
export function ListPicker({
  value,
  onChange,
  newName,
  onNewNameChange,
  newNameError,
  memberOf = [],
  allowCreate = true,
  label = "List",
}: {
  value: string;
  onChange: (value: string) => void;
  newName: string;
  onNewNameChange: (name: string) => void;
  newNameError?: string;
  memberOf?: string[];
  allowCreate?: boolean;
  label?: string;
}) {
  const id = useId();
  const { me } = useWorkspace();
  const { canManageAllLists, canManageLists } = usePermissions();
  const [q, setQ] = useState("");
  const lists = useLeadLists({
    q: q || undefined,
    ownerUserId: canManageAllLists ? undefined : me.user.id,
    sort: "name:asc",
    pageSize: 50,
  });
  const rows: LeadList[] = lists.data?.data ?? [];
  const create = allowCreate && canManageLists;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p id={`${id}-label`} className="text-sm font-medium">
        {label}
      </p>
      <SearchField
        label="Search lists"
        defaultValue={q}
        onDebouncedChange={setQ}
        appearance="outlined"
      />
      {lists.isPending ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading lists"
          className="flex flex-col gap-2"
        >
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : lists.isError && !lists.data ? (
        <ErrorState
          title="Could not load lists"
          message={friendlyMessage(lists.error)}
          requestId={requestIdOf(lists.error)}
          onRetry={() => void lists.refetch()}
        />
      ) : (
        <RadioGroup
          value={value}
          onValueChange={onChange}
          aria-labelledby={`${id}-label`}
          className="max-h-64 gap-0 overflow-y-auto"
        >
          {rows.map((l) => {
            const already = memberOf.includes(l.id);
            return (
              <label
                key={l.id}
                htmlFor={`${id}-${l.id}`}
                className="state-layer transition-ui flex min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-2 has-[:disabled]:cursor-not-allowed"
              >
                <RadioGroupItem id={`${id}-${l.id}`} value={l.id} disabled={already} />
                <span className="flex min-w-0 flex-col">
                  <span className="break-anywhere text-sm">{l.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {already ? "Already on this list · " : ""}
                    {plural(l.itemCount, "business", "businesses")}
                  </span>
                </span>
              </label>
            );
          })}
          {rows.length === 0 ? (
            <p className="text-muted-foreground px-2 py-2 text-sm">
              {q ? `No list name starts with “${q}”.` : "No lists yet."}
            </p>
          ) : null}
          {create ? (
            <label
              htmlFor={`${id}-new`}
              className="state-layer transition-ui flex min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-2"
            >
              <RadioGroupItem id={`${id}-new`} value={NEW_LIST} />
              <ListPlus aria-hidden className="text-muted-foreground size-4" />
              <span className="text-sm">New list</span>
            </label>
          ) : null}
        </RadioGroup>
      )}
      {value === NEW_LIST ? (
        <TextField
          id={`${id}-name`}
          label="New list name"
          required
          maxLength={80}
          value={newName}
          onChange={(e) => onNewNameChange(e.target.value)}
          error={newNameError}
          autoFocus
        />
      ) : null}
    </div>
  );
}

/** Creates the list when "New list" is chosen; resolves to the list id to use. */
export function useResolveList() {
  const create = useCreateList();
  return {
    create,
    resolve: async (value: string, newName: string): Promise<string> => {
      if (value !== NEW_LIST) return value;
      const list = await create.mutateAsync({ name: newName.trim() });
      return list.id;
    },
  };
}

export function newListNameError(value: string, name: string, err: unknown): string | undefined {
  if (value !== NEW_LIST) return undefined;
  if (isApiError(err) && err.code === "CONFLICT")
    return "A list with this name already exists. Choose it from the list or pick another name.";
  if (isApiError(err) && err.code === "VALIDATION_FAILED")
    return err.details?.[0]?.message ?? "Check the name.";
  return name.trim() ? undefined : "Name the new list.";
}

/** A result summary for the toast after adding businesses to a list. */
export function addResultText(res: ListItemsResult): { title: string; description?: string } {
  const s = res.summary;
  const parts: string[] = [];
  if (s.unchanged) parts.push(`${plural(s.unchanged, "was", "were")} already on it`);
  if (s.suppressed)
    parts.push(`${plural(s.suppressed, "suppressed business", "suppressed businesses")} skipped`);
  if (s.notFound) parts.push(`${plural(s.notFound, "business", "businesses")} not found`);
  if (s.listFull)
    parts.push(`${plural(s.listFull, "business", "businesses")} did not fit (list full)`);
  return {
    title: s.changed
      ? `Added ${plural(s.changed, "business", "businesses")} to “${res.list.name}”`
      : `Nothing added to “${res.list.name}”`,
    description: parts.length ? `${parts.join("; ")}.` : undefined,
  };
}

/**
 * Add one business (business detail) or a few (up to 100) to a list with POST /lists/:id/items.
 * Larger selections go through bulk operations.
 */
export function AddToListDialog({
  open,
  onOpenChange,
  businessIds,
  businessName,
  memberOf = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessIds: string[];
  businessName: string;
  memberOf?: string[];
}) {
  const [value, setValue] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const add = useListItemsChange("add");
  const { resolve, create } = useResolveList();
  const pending = add.isPending || create.isPending;

  useEffect(() => {
    if (open) {
      setValue("");
      setNewName("");
      setError(null);
      setNameError(undefined);
    }
  }, [open]);

  const save = async () => {
    setError(null);
    setNameError(undefined);
    if (value === NEW_LIST && !newName.trim()) {
      setNameError("Name the new list.");
      return;
    }
    let listId: string;
    try {
      listId = await resolve(value, newName);
    } catch (err) {
      const msg = newListNameError(value, newName, err);
      if (msg) setNameError(msg);
      else setError(err);
      return;
    }
    add.mutate(
      { listId, businessIds },
      {
        onSuccess: (res) => {
          onOpenChange(false);
          const t = addResultText(res);
          if (res.summary.changed) toast.success(t.title, { description: t.description });
          else toast.info(t.title, { description: t.description });
        },
        onError: setError,
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (pending ? undefined : onOpenChange(o))}>
      <DialogContent data-testid="add-to-list-dialog">
        <DialogHeader>
          <DialogTitle>Add to list</DialogTitle>
          <DialogDescription>
            {businessIds.length === 1
              ? `Add ${businessName} to a lead list.`
              : `Add ${plural(businessIds.length, "business", "businesses")} to a lead list.`}{" "}
            Suppressed businesses are never added.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4 pt-3 [--field-bg:var(--surface-elevated)]">
          <ListPicker
            value={value}
            onChange={setValue}
            newName={newName}
            onNewNameChange={setNewName}
            newNameError={nameError}
            memberOf={memberOf}
          />
          {error ? (
            <ErrorState
              title="Could not add to the list"
              message={friendlyMessage(error)}
              requestId={requestIdOf(error)}
            />
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="text" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={pending} disabled={!value}>
            {value === NEW_LIST ? "Create list and add" : "Add to list"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
