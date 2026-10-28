"use client";

import { ROLE_LABELS, type OrganizationMembershipSummary } from "@leadforge/contracts";
import { Building2, Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  cn,
} from "@leadforge/ui";

/** Organization picker: a tonal pill with the org name from 480px, an icon button below. */
export function OrgSwitcher({
  organizations,
  active,
  onSelect,
  className,
}: {
  organizations: OrganizationMembershipSummary[];
  active: OrganizationMembershipSummary | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Switch organization. Current: ${active?.name ?? "none"}`}
        className={cn(
          "state-layer text-foreground flex h-10 min-w-0 shrink items-center gap-2 rounded-full",
          "min-[480px]:bg-surface-container-high w-10 justify-center min-[480px]:w-auto min-[480px]:max-w-56 min-[480px]:justify-start min-[480px]:pl-3 min-[480px]:pr-3",
          className,
        )}
      >
        <Building2 aria-hidden className="text-muted-foreground size-5 shrink-0" />
        <span className="hidden min-w-0 truncate text-sm font-medium min-[480px]:inline">
          {active?.name ?? "Select organization"}
        </span>
        <ChevronDown
          aria-hidden
          className="text-muted-foreground hidden size-4 shrink-0 min-[480px]:inline"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {organizations.map((org) => (
          <OrgMenuItem key={org.id} org={org} active={org.id === active?.id} onSelect={onSelect} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function OrgMenuItem({
  org,
  active,
  onSelect,
}: {
  org: OrganizationMembershipSummary;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <DropdownMenuItem onSelect={() => onSelect(org.id)} className="items-start">
      <Check
        aria-hidden
        className={cn("!text-primary mt-0.5", active ? "opacity-100" : "opacity-0")}
      />
      <span className="flex min-w-0 flex-col">
        <span className="break-anywhere font-medium">{org.name}</span>
        <span className="text-muted-foreground text-xs">{ROLE_LABELS[org.role]}</span>
      </span>
      {active ? <span className="sr-only">(current)</span> : null}
    </DropdownMenuItem>
  );
}
