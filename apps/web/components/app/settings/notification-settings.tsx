"use client";

import type { NotificationPreferences } from "@leadforge/contracts";
import { Card, CardTitle, ChoiceField, ErrorState, Skeleton, Switch, toast } from "@leadforge/ui";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "@/lib/hooks/use-notifications";

const ROWS: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  {
    key: "inappAll",
    label: "In-app notifications",
    description:
      "The bell in the top bar: jobs you started (discovery, imports, website analyses, exports and bulk operations) when they finish or fail, and leads assigned to you.",
  },
  {
    key: "emailAssignments",
    label: "Email when a lead is assigned to you",
    description:
      "Sent when someone makes you the owner of a lead, once per bulk operation. Assigning yourself never sends one.",
  },
  {
    key: "emailJobEvents",
    label: "Email when a discovery job fails",
    description: "Sent to your sign-in address for jobs you started.",
  },
  {
    key: "emailBilling",
    label: "Billing emails",
    description:
      "Receipts and payment problems. Billing is not available yet; this setting applies once it is.",
  },
];

/**
 * Settings → Notifications: the signed-in user's own preferences in this workspace
 * (GET and PUT /notifications/preferences). Each switch saves on its own; the saved
 * preferences from the response replace what is shown (not optimistic). Account emails
 * (verification, password reset, invitations) are always sent.
 */
export function NotificationSettings() {
  const prefs = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();

  return (
    <Card className="max-w-3xl">
      <div className="flex flex-col gap-1 p-5 pb-3 sm:p-6 sm:pb-3">
        <CardTitle className="leading-normal">Notifications</CardTitle>
        <p className="text-muted-foreground text-sm">
          Your own preferences in this workspace. Account emails (verification, password reset,
          invitations) are always sent.
        </p>
      </div>
      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        {prefs.isPending ? (
          <div
            className="flex flex-col gap-3"
            role="status"
            aria-busy="true"
            aria-label="Loading preferences"
          >
            {ROWS.map((r) => (
              <Skeleton key={r.key} className="h-12 rounded-md" />
            ))}
          </div>
        ) : prefs.isError ? (
          <ErrorState
            title="Could not load your notification preferences"
            message={friendlyMessage(prefs.error)}
            requestId={requestIdOf(prefs.error)}
            onRetry={() => void prefs.refetch()}
          />
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {ROWS.map((r) => {
              const saving = update.isPending && update.variables && r.key in update.variables;
              return (
                <li key={r.key} className="py-3 first:pt-0 last:pb-0">
                  <ChoiceField
                    id={`notification-pref-${r.key}`}
                    label={r.label}
                    description={r.description}
                    controlPosition="end"
                    control={
                      <Switch
                        // emailAssignments is optional in older responses; the API default is on.
                        checked={prefs.data[r.key] ?? true}
                        disabled={Boolean(saving)}
                        aria-busy={saving ? true : undefined}
                        onCheckedChange={(checked) =>
                          update.mutate(
                            { [r.key]: checked },
                            {
                              onSuccess: () =>
                                toast.success(`${r.label} ${checked ? "turned on" : "turned off"}`),
                              onError: (err) =>
                                toast.error("Could not save the preference", {
                                  description: friendlyMessage(err),
                                }),
                            },
                          )
                        }
                      />
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
