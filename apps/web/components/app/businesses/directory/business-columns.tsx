"use client";

import { EXPIRED_NAME_LABEL, type BusinessListItem } from "@leadforge/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, EllipsisVertical, EyeOff, PanelRightOpen } from "lucide-react";
import Link from "next/link";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FieldStatus,
  cn,
  toast,
} from "@leadforge/ui";
import { formatDate } from "@/lib/format";
import { SourceNames, SuppressedBadge, WhatsAppIndicator, shortLocation } from "../shared";

export interface RowActionHandlers {
  canSuppress: boolean;
  onSuppress: (row: BusinessListItem) => void;
}

function BusinessName({ row }: { row: BusinessListItem }) {
  const expired = row.states.name === "expired";
  return (
    <div className="flex w-[13rem] flex-col gap-0.5 min-[1280px]:w-[16rem]">
      <Link
        href={`/app/businesses/${row.id}`}
        className={
          expired
            ? "text-muted-foreground rounded-xs break-words italic hover:underline"
            : "text-foreground hover:text-primary rounded-xs break-words font-medium hover:underline"
        }
      >
        {expired ? EXPIRED_NAME_LABEL : row.name}
      </Link>
      {row.categories.length ? (
        <span className="text-muted-foreground break-words text-xs">
          {row.categories.slice(0, 3).join(" · ")}
          {row.categories.length > 3 ? ` +${row.categories.length - 3}` : ""}
        </span>
      ) : null}
      {row.suppressed ? (
        <span className="pt-1">
          <SuppressedBadge />
        </span>
      ) : null}
    </div>
  );
}

function ValueWithState({
  value,
  state,
  extra,
  missingLabel,
  className,
}: {
  value: string | null;
  state: BusinessListItem["states"]["phone"];
  extra?: React.ReactNode;
  missingLabel: string;
  /** Width bounds for the cell content (td widths are not honoured by table layout). */
  className?: string;
}) {
  if (state === "missing") {
    return <span className="text-muted-foreground whitespace-nowrap">{missingLabel}</span>;
  }
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {value ? <span className="break-words">{value}</span> : null}
      <FieldStatus state={state} size="sm" />
      {extra}
    </div>
  );
}

export function RowActions({
  row,
  handlers,
}: {
  row: BusinessListItem;
  handlers: RowActionHandlers;
}) {
  const name = row.states.name === "expired" ? "business" : row.name;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`}>
          <EllipsisVertical aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/app/businesses/${row.id}`}>
            <PanelRightOpen aria-hidden />
            Open details
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void navigator.clipboard.writeText(row.id).then(
              () => toast.success("Business ID copied"),
              () => toast.error("Could not copy the business ID"),
            );
          }}
        >
          <Copy aria-hidden />
          Copy business ID
        </DropdownMenuItem>
        {handlers.canSuppress && !row.suppressed ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => handlers.onSuppress(row)}>
              <EyeOff aria-hidden />
              Suppress
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Default hidden columns: shown from the "Show or hide columns" menu. */
export const DEFAULT_HIDDEN_COLUMNS = { createdAt: false } as const;

/**
 * One score number out of 100. Fit and data confidence are always separate columns and are never
 * combined. Unscored businesses say so instead of showing 0.
 */
function ScoreCell({ value, label }: { value: number | undefined; label: string }) {
  if (value === undefined) {
    return (
      <span className="text-muted-foreground whitespace-nowrap" title={`${label}: not scored yet`}>
        Not scored
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap tabular-nums" title={`${label}: ${value} of 100`}>
      {value}
      <span className="text-muted-foreground text-xs"> / 100</span>
    </span>
  );
}

export function businessColumns(handlers: RowActionHandlers): ColumnDef<BusinessListItem>[] {
  return [
    {
      accessorKey: "name",
      header: "Business",
      enableHiding: false,
      meta: { label: "Business", mobileTitle: true },
      cell: ({ row }) => <BusinessName row={row.original} />,
    },
    {
      id: "location",
      header: "Location",
      meta: { label: "Location" },
      cell: ({ row }) => {
        const r = row.original;
        const text = shortLocation(r.location);
        if (!text)
          return <span className="text-muted-foreground whitespace-nowrap">No location</span>;
        return (
          <div className="flex w-[9rem] flex-col gap-0.5">
            <span className="break-words">{text}</span>
            {r.states.location !== "unverified" && r.states.location !== "verified" ? (
              <FieldStatus state={r.states.location} size="sm" />
            ) : null}
          </div>
        );
      },
    },
    {
      id: "fit",
      accessorFn: (r) => r.score?.fit ?? null,
      header: "Fit",
      meta: { label: "Fit score", align: "end" },
      cell: ({ row }) => <ScoreCell value={row.original.score?.fit} label="Fit score" />,
    },
    {
      id: "dataConfidence",
      accessorFn: (r) => r.score?.dataConfidence ?? null,
      header: "Data confidence",
      meta: { label: "Data confidence", align: "end" },
      cell: ({ row }) => (
        <ScoreCell value={row.original.score?.dataConfidence} label="Data confidence" />
      ),
    },
    {
      id: "website",
      header: "Website",
      meta: { label: "Website" },
      cell: ({ row }) => (
        <ValueWithState
          className="max-w-[15rem]"
          value={row.original.website?.domain ?? row.original.website?.value ?? null}
          state={row.original.states.website}
          missingLabel="No website"
        />
      ),
    },
    {
      id: "phone",
      header: "Phone",
      meta: { label: "Phone", cellClassName: "whitespace-nowrap" },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <ValueWithState
            value={r.phone?.international ?? r.phone?.value ?? null}
            state={r.states.phone}
            missingLabel="No phone"
            extra={
              <>
                {r.phoneCount > 1 ? (
                  <span className="text-muted-foreground text-xs">+{r.phoneCount - 1} more</span>
                ) : null}
                {r.whatsapp !== "unknown" ? (
                  <WhatsAppIndicator status={r.whatsapp} size="sm" />
                ) : null}
              </>
            }
          />
        );
      },
    },
    {
      id: "email",
      header: "Email",
      meta: { label: "Email" },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <ValueWithState
            className="max-w-[16rem]"
            value={r.email?.value ?? null}
            state={r.states.email}
            missingLabel="No email"
            extra={
              r.emailCount > 1 ? (
                <span className="text-muted-foreground text-xs">+{r.emailCount - 1} more</span>
              ) : null
            }
          />
        );
      },
    },
    {
      id: "sources",
      header: "Sources",
      meta: { label: "Sources" },
      cell: ({ row }) => (
        <span className="block w-[7.5rem] text-xs">
          <SourceNames sources={row.original.sources} short />
        </span>
      ),
    },
    {
      accessorKey: "lastVerifiedAt",
      header: "Last verified",
      meta: { label: "Last verified" },
      cell: ({ row }) => (
        <span className="text-muted-foreground whitespace-nowrap">
          {formatDate(row.original.lastVerifiedAt)}
        </span>
      ),
    },
    {
      accessorKey: "updatedAt",
      header: "Updated",
      meta: { label: "Updated" },
      cell: ({ row }) => (
        <time dateTime={row.original.updatedAt} className="text-muted-foreground whitespace-nowrap">
          {formatDate(row.original.updatedAt)}
        </time>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      meta: { label: "Created" },
      cell: ({ row }) => (
        <time dateTime={row.original.createdAt} className="text-muted-foreground whitespace-nowrap">
          {formatDate(row.original.createdAt)}
        </time>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableHiding: false,
      meta: { label: "Actions", align: "end", mobileActions: true },
      cell: ({ row }) => <RowActions row={row.original} handlers={handlers} />,
    },
  ];
}
