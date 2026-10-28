"use client";

import { CRM_LIMITS, EXPIRED_NAME_LABEL, type BusinessListItem } from "@leadforge/contracts";
import { useEffect, useId, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  SearchField,
  Skeleton,
  toast,
} from "@leadforge/ui";
import { shortLocation } from "@/components/app/businesses/shared";
import { addResultText } from "@/components/app/crm/list-picker";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { plural } from "@/lib/format";
import { useBusinessList } from "@/lib/hooks/use-businesses";
import { useListItemsChange } from "@/lib/hooks/use-lists";

/**
 * Finds businesses by name, place, domain, email or phone digits (the directory search) and adds
 * the chosen ones to a list, up to 100 at a time. Suppressed businesses are not offered.
 */
export function AddBusinessesDialog({
  open,
  onOpenChange,
  listId,
  listName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listId: string;
  listName: string;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const add = useListItemsChange("add");
  const results = useBusinessList(
    { q: q || undefined, pageSize: 10, sort: "name:asc", suppression: "exclude" },
    open,
  );
  const rows: BusinessListItem[] = open ? (results.data?.data ?? []) : [];

  useEffect(() => {
    if (open) {
      setQ("");
      setPicked(new Map());
      add.reset();
    }
  }, [open]);

  const toggle = (row: BusinessListItem, on: boolean) => {
    setPicked((prev) => {
      const next = new Map(prev);
      if (on && next.size < CRM_LIMITS.listItemsPerRequest) next.set(row.id, row.name);
      else next.delete(row.id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (add.isPending ? undefined : onOpenChange(o))}>
      <DialogContent size="lg" data-testid="add-businesses-dialog">
        <DialogHeader>
          <DialogTitle>Add businesses to “{listName}”</DialogTitle>
          <DialogDescription>
            Search the directory and tick businesses to add, up to {CRM_LIMITS.listItemsPerRequest}{" "}
            at a time. For more, select them in the directory and use Add to list.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3 pt-3">
          <SearchField
            label="Search businesses"
            appearance="outlined"
            defaultValue=""
            onDebouncedChange={setQ}
            autoFocus
          />
          {results.isPending ? (
            <div
              role="status"
              aria-busy="true"
              aria-label="Searching businesses"
              className="flex flex-col gap-2"
            >
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : results.isError && !results.data ? (
            <ErrorState
              title="Could not search businesses"
              message={friendlyMessage(results.error)}
              requestId={requestIdOf(results.error)}
              onRetry={() => void results.refetch()}
            />
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground py-4 text-sm">
              {q ? `No business matches “${q}”.` : "No businesses yet."}
            </p>
          ) : (
            <ul className="flex min-w-0 flex-col" aria-label="Search results">
              {rows.map((r) => {
                const cid = `${id}-${r.id}`;
                const name = r.states.name === "expired" ? EXPIRED_NAME_LABEL : r.name;
                return (
                  <li key={r.id} className="min-w-0">
                    <label
                      htmlFor={cid}
                      className="state-layer transition-ui flex min-w-0 cursor-pointer items-start gap-3 rounded-md px-2 py-2.5"
                    >
                      <Checkbox
                        id={cid}
                        className="mt-0.5"
                        checked={picked.has(r.id)}
                        onCheckedChange={(v) => toggle(r, v === true)}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="break-anywhere text-sm">{name}</span>
                        <span className="text-muted-foreground break-anywhere text-xs">
                          {[r.categories[0], shortLocation(r.location)]
                            .filter(Boolean)
                            .join(" · ") || "No category or place"}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {add.isError ? (
            <ErrorState
              title="Could not add the businesses"
              message={friendlyMessage(add.error)}
              requestId={requestIdOf(add.error)}
            />
          ) : null}
        </DialogBody>
        <DialogFooter className="items-center">
          <p className="text-muted-foreground mr-auto text-xs" aria-live="polite">
            {picked.size
              ? `${plural(picked.size, "business", "businesses")} selected`
              : "None selected"}
          </p>
          <Button variant="text" onClick={() => onOpenChange(false)} disabled={add.isPending}>
            Cancel
          </Button>
          <Button
            disabled={picked.size === 0}
            loading={add.isPending}
            onClick={() =>
              add.mutate(
                { listId, businessIds: [...picked.keys()] },
                {
                  onSuccess: (res) => {
                    onOpenChange(false);
                    const t = addResultText(res);
                    toast.success(t.title, { description: t.description });
                  },
                },
              )
            }
          >
            Add {picked.size || ""} to list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
