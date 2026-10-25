"use client";

import { ROLE_LABELS, type OrganizationMembershipSummary } from "@leadforge/contracts";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  cn,
} from "@leadforge/ui";

export function OrgSwitcher({
  organizations,
  active,
  onSelect,
}: {
  organizations: OrganizationMembershipSummary[];
  active: OrganizationMembershipSummary | null;
  onSelect: (id: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 max-w-[40vw] gap-1.5 px-2 min-[480px]:max-w-56"
          aria-label="Switch organization"
        >
          <Building2 aria-hidden className="shrink-0" />
          <span className="hidden truncate min-[480px]:inline">
            {active?.name ?? "Select organization"}
          </span>
          <ChevronsUpDown
            aria-hidden
            className="text-muted-foreground hidden shrink-0 min-[480px]:inline"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {organizations.map((org) => (
          <DropdownMenuItem key={org.id} onSelect={() => onSelect(org.id)} className="items-start">
            <Check
              aria-hidden
              className={cn("mt-0.5 shrink-0", org.id === active?.id ? "opacity-100" : "opacity-0")}
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{org.name}</span>
              <span className="text-muted-foreground text-xs">{ROLE_LABELS[org.role]}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
