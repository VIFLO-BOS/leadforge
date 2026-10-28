"use client";

import { CalendarClock, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Banner, Button, FadeIn } from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { useOrgProfile } from "@/lib/hooks/use-org-lifecycle";
import { usePermissions } from "@/lib/hooks/use-permissions";
import {
  daysUntil,
  deletionStateOf,
  ORG_LIFECYCLE_ANCHOR,
  ORG_LIFECYCLE_HREF,
  purgeDateLabel,
} from "@/lib/org-lifecycle";

function dismissKey(orgId: string, requestedAt: string): string {
  return `lf.orgDeletionBanner:${orgId}:${requestedAt}`;
}

/**
 * Stage 10: shown on every dashboard page while the organization is scheduled for deletion, to
 * every member. The state comes from GET /organizations/current (re-read on focus and every 5
 * minutes), falling back to the /auth/me membership while that loads or if it fails. Owners cannot
 * dismiss it and get the way to cancel; other members can hide it for the rest of the tab session
 * and are told to ask an owner.
 */
export function OrgDeletionBanner() {
  const { org } = useWorkspace();
  const { can } = usePermissions();
  const owner = can("organization:delete");
  const profile = useOrgProfile();
  const state = deletionStateOf(profile.data ?? org);
  const key = state.requestedAt ? dismissKey(org.id, state.requestedAt) : null;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!key) {
      setDismissed(false);
      return;
    }
    try {
      setDismissed(window.sessionStorage.getItem(key) === "1");
    } catch {
      setDismissed(false);
    }
  }, [key]);

  if (!state.pending || (!owner && dismissed)) return null;
  const date = purgeDateLabel(state.purgeAfter);
  const days = daysUntil(state.purgeAfter);
  const when =
    days === null
      ? ""
      : days === 0
        ? " (the purge can start at any time now)"
        : ` (in ${days} day${days === 1 ? "" : "s"})`;

  return (
    <FadeIn duration={0.25} className="mb-5">
      <Banner
        tone="warning"
        icon={CalendarClock}
        title="This organization is scheduled for deletion"
        description={
          owner
            ? `On ${date}${when} its workspace data is deleted for good; billing records are kept. Until then new discovery, website analysis, imports, purchases and invitations are paused. Cancel the deletion to keep everything.`
            : `On ${date}${when} its workspace data is deleted for good. New discovery, website analysis, imports, purchases and invitations are paused until then. Only an owner can cancel the deletion; ask one if this workspace should be kept.`
        }
        data-testid="org-deletion-banner"
        data-audience={owner ? "owner" : "member"}
        actions={
          owner ? (
            <Button
              asChild
              size="sm"
              variant="outline"
              className="h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left"
            >
              <Link
                href={`${ORG_LIFECYCLE_HREF}#${ORG_LIFECYCLE_ANCHOR}`}
                data-testid="org-deletion-banner-cancel"
              >
                <Undo2 aria-hidden /> Cancel deletion
              </Link>
            </Button>
          ) : undefined
        }
        dismissLabel="Dismiss: organization scheduled for deletion"
        onDismiss={
          owner || !key
            ? undefined
            : () => {
                try {
                  window.sessionStorage.setItem(key, "1");
                } catch {
                  /* storage unavailable */
                }
                setDismissed(true);
              }
        }
      />
    </FadeIn>
  );
}
