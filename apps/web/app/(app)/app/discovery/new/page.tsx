import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { DiscoveryWizard } from "@/components/app/discovery/wizard/discovery-wizard";

export const metadata: Metadata = { title: "Create a discovery job" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <DiscoveryWizard />
    </Suspense>
  );
}
