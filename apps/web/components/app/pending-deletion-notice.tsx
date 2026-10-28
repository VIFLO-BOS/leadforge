"use client";

import { CalendarClock, Undo2 } from "lucide-react";
import Link from "next/link";
import { Banner, Button } from "@leadforge/ui";
import { usePermissions } from "@/lib/hooks/use-permissions";
import {
  isPendingDeletion,
  ORG_LIFECYCLE_ANCHOR,
  ORG_LIFECYCLE_HREF,
  pendingDeletionMessage,
  pendingDeletionPurgeAfter,
} from "@/lib/org-lifecycle";

/** Short title for flows that list error titles (toasts, dialogs). */
export const PENDING_DELETION_TITLE = "Paused: this organization is scheduled for deletion";

/**
 * Explains a 409 ORGANIZATION_PENDING_DELETION where new paid or long work was refused (discovery,
 * analysis and enrichment, imports, checkout, invitations): what is paused, until when, and who
 * can lift it. Owners get the way to cancel the deletion. Renders nothing for other errors.
 */
export function PendingDeletionNotice({
  error,
  className,
  /** What was refused, for the description ("Nothing was queued."). */
  outcome,
}: {
  error: unknown;
  className?: string;
  outcome?: string;
}) {
  const { can } = usePermissions();
  if (!isPendingDeletion(error)) return null;
  const owner = can("organization:delete");
  return (
    <Banner
      tone="warning"
      icon={CalendarClock}
      className={className}
      title={PENDING_DELETION_TITLE}
      description={`${pendingDeletionMessage(pendingDeletionPurgeAfter(error))}${outcome ? ` ${outcome}` : ""}`}
      data-testid="pending-deletion-block"
      actions={
        owner ? (
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left"
          >
            <Link href={`${ORG_LIFECYCLE_HREF}#${ORG_LIFECYCLE_ANCHOR}`}>
              <Undo2 aria-hidden /> Cancel deletion
            </Link>
          </Button>
        ) : undefined
      }
    />
  );
}
