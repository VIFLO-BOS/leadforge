"use client";

import { roleHasPermission } from "@leadforge/contracts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@leadforge/ui";
import { useWorkspace } from "../app-shell";
import { NotificationSettings } from "./notification-settings";
import { OrganizationSettings } from "./organization-settings";
import { PipelineSettings } from "./pipeline-settings";
import { ScoringSettings } from "./scoring-settings";
import { SecuritySettings } from "./security-settings";

const TABS = [
  "organization",
  "scoring",
  "pipeline",
  "security",
  "notifications",
  "api-keys",
] as const;
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
  const canEditScoring = roleHasPermission(org.role, "settings:scoring");
  const canEditPipeline = roleHasPermission(org.role, "settings:pipeline");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Organization profile, lead scoring, pipeline stages, account security and preferences."
      />
      <Tabs value={tab} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`)}>
        <TabsList aria-label="Settings sections">
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="scoring">Scoring</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline stages</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="api-keys" disabled>
            API keys
            <Badge variant="outline" className="h-5 px-2 text-[10px]">
              Coming soon
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="organization">
          <OrganizationSettings canEdit={canEditOrg} />
        </TabsContent>
        <TabsContent value="scoring">
          {tab === "scoring" ? <ScoringSettings canEdit={canEditScoring} /> : null}
        </TabsContent>
        <TabsContent value="pipeline">
          {tab === "pipeline" ? <PipelineSettings canEdit={canEditPipeline} /> : null}
        </TabsContent>
        <TabsContent value="security">
          <SecuritySettings />
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
