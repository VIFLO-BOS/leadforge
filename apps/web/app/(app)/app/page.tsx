"use client";

import { Building2 } from "lucide-react";
import { useWorkspace } from "@/components/app/app-shell";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
} from "@leadforge/ui";

const METRICS = [
  "Total discovered businesses",
  "Verified contacts",
  "Qualified leads",
  "Active discovery jobs",
  "Failed jobs needing attention",
  "Credits available",
  "Subscription status",
  "Businesses discovered this period",
];

export default function OverviewPage() {
  const { org } = useWorkspace();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={org.name}
        description="Workspace overview. Metrics appear here as soon as the underlying features are live and have data."
      />

      <section aria-labelledby="metrics-title" className="flex flex-col gap-3">
        <h2 id="metrics-title" className="text-muted-foreground text-sm font-semibold">
          Metrics
        </h2>
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
          {METRICS.map((label) => (
            <Card key={label}>
              <CardHeader className="p-4">
                <CardTitle className="text-muted-foreground text-xs font-medium">{label}</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <p className="text-muted-foreground text-sm">No data yet</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <EmptyState
        icon={Building2}
        title="No businesses yet"
        description="Discovery jobs populate this workspace with businesses, their contact details and the source of every field."
        action={
          <div className="flex flex-col items-center gap-2">
            <Button disabled aria-describedby="discovery-note">
              Create discovery job
            </Button>
            <p
              id="discovery-note"
              className="text-muted-foreground flex items-center gap-1.5 text-xs"
            >
              <Badge variant="outline">Coming soon</Badge> Available in a later release
            </p>
          </div>
        }
      />
    </div>
  );
}
