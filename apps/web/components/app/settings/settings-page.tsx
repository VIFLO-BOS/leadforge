"use client";

import { roleHasPermission } from "@leadforge/contracts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@leadforge/ui";
import { useWorkspace } from "../app-shell";
import { OrganizationSettings } from "./organization-settings";
import { SecuritySettings } from "./security-settings";

const TABS = ["organization", "security", "notifications", "api-keys"] as const;
type Tab = (typeof TABS)[number];

export function SettingsPage() {
  const { org } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("tab");
  const tab: Tab =
    TABS.includes(requested as Tab) && requested !== "api-keys"
      ? (requested as Tab)
      : "organization";
  const canEditOrg = roleHasPermission(org.role, "organization:settings");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Organization profile, account security and preferences."
      />
      <Tabs value={tab} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`)}>
        <TabsList aria-label="Settings sections">
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="api-keys" disabled className="gap-2">
            API keys
            <Badge variant="outline" className="text-[10px]">
              Coming soon
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="organization">
          <OrganizationSettings canEdit={canEditOrg} />
        </TabsContent>
        <TabsContent value="security">
          <SecuritySettings />
        </TabsContent>
        <TabsContent value="notifications">
          <div className="border-border bg-surface text-muted-foreground rounded-lg border p-5 text-sm">
            Notification preferences arrive together with in-app and email notifications in a later
            phase.
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
