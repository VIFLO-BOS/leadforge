"use client";

import { ListPlus } from "lucide-react";
import Link from "next/link";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  Skeleton,
} from "@leadforge/ui";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { plural } from "@/lib/format";
import { useLeadLists } from "@/lib/hooks/use-lists";
import { usePermissions } from "@/lib/hooks/use-permissions";

/** The lead lists that hold this business (GET /lists?businessId), with Add to list. */
export function BusinessListsCard({
  businessId,
  onAdd,
}: {
  businessId: string;
  onAdd?: () => void;
}) {
  const { canManageLists } = usePermissions();
  const lists = useLeadLists({ businessId, pageSize: 50, sort: "name:asc" });
  const rows = lists.data?.data ?? [];
  return (
    <Card data-testid="business-lists">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Lead lists</CardTitle>
        {canManageLists && onAdd ? (
          <Button variant="text" size="sm" onClick={onAdd}>
            <ListPlus aria-hidden /> Add to list
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {lists.isPending ? (
          <div role="status" aria-busy="true" aria-label="Loading lists">
            <Skeleton className="h-5 w-48" />
          </div>
        ) : lists.isError && !lists.data ? (
          <ErrorState
            title="Could not load lists"
            message={friendlyMessage(lists.error)}
            requestId={requestIdOf(lists.error)}
            onRetry={() => void lists.refetch()}
          />
        ) : rows.length ? (
          <ul className="flex min-w-0 flex-col gap-1.5">
            {rows.map((l) => (
              <li
                key={l.id}
                className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2"
              >
                <Link
                  href={`/app/lists/${l.id}`}
                  className="text-primary break-anywhere rounded-xs text-sm hover:underline"
                >
                  {l.name}
                </Link>
                <span className="text-muted-foreground text-xs">
                  {plural(l.itemCount, "business", "businesses")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">Not on any list.</p>
        )}
      </CardContent>
    </Card>
  );
}
