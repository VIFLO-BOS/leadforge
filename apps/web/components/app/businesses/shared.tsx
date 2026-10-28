"use client";

import type { BusinessListItem, LocationValue, WhatsAppStatus } from "@leadforge/contracts";
import { CircleHelp, EyeOff, MessageCircle, MessageCircleQuestion } from "lucide-react";
import Link from "next/link";
import {
  Badge,
  StatusIndicator,
  cn,
  type BreadcrumbItem,
  type StatusIndicatorProps,
} from "@leadforge/ui";
import { WHATSAPP_DESCRIPTIONS, WHATSAPP_LABELS, sourceLabel } from "@/lib/labels";

/**
 * WhatsApp tri-state shown honestly: confirmed needs explicit evidence, team-asserted is a
 * person's word, unknown is unknown. Icon plus text, never colour alone.
 */
export function WhatsAppIndicator({
  status,
  ...props
}: { status: WhatsAppStatus } & Omit<StatusIndicatorProps, "tone" | "label" | "icon">) {
  const tone = status === "confirmed" ? "success" : status === "user_asserted" ? "info" : "neutral";
  const icon =
    status === "confirmed"
      ? MessageCircle
      : status === "user_asserted"
        ? MessageCircleQuestion
        : CircleHelp;
  return (
    <StatusIndicator
      tone={tone}
      icon={icon}
      label={`WhatsApp ${WHATSAPP_LABELS[status].toLowerCase()}`}
      title={WHATSAPP_DESCRIPTIONS[status]}
      data-whatsapp={status}
      {...props}
    />
  );
}

export function SuppressedBadge() {
  return (
    <Badge variant="warning" title="Excluded from exports and hidden from the directory by default">
      <EyeOff aria-hidden />
      Suppressed
    </Badge>
  );
}

export function SourceNames({ sources, short }: { sources: readonly string[]; short?: boolean }) {
  if (sources.length === 0) return <span className="text-muted-foreground">No sources</span>;
  return <span>{sources.map((s) => sourceLabel(s, short)).join(", ")}</span>;
}

type ListLocation = BusinessListItem["location"];

/** Short "City, State" line for tables and cards. */
export function shortLocation(location: ListLocation | LocationValue | null): string | null {
  if (!location) return null;
  const parts = [location.locality, location.region].filter(
    (p, i, all): p is string => Boolean(p) && all.indexOf(p) === i,
  );
  if (parts.length) return parts.join(", ");
  return location.formatted ?? null;
}

/** Full address for detail views. */
export function fullLocation(location: LocationValue | null): string | null {
  if (!location) return null;
  if (location.formatted) return location.formatted;
  const parts = [
    location.street,
    location.locality,
    location.lga,
    location.region,
    location.postalCode,
    location.country,
  ].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(", ") : null;
}

/**
 * Table cell content with a fixed width from 480px (where rows are a table, not cards).
 * Table layout ignores widths on <td> once the table overflows its scroll region and squeezes
 * columns to their min-content width; a sized block inside the cell keeps columns readable and
 * lets the table scroll sideways instead. Words break only when a single token is too long.
 */
export function CellBox({
  width,
  className,
  children,
}: {
  width: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{ "--cell-w": width } as React.CSSProperties}
      className={cn("min-w-0 break-words min-[480px]:w-[var(--cell-w)]", className)}
    >
      {children}
    </div>
  );
}

/** Breadcrumbs `renderLink` that uses the Next.js router. */
export function renderBreadcrumbLink(item: BreadcrumbItem, className: string) {
  return (
    <Link href={item.href ?? "#"} className={className}>
      {item.label}
    </Link>
  );
}
