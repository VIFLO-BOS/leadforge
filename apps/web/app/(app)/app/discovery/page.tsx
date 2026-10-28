import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { DiscoveryJobsPage } from "@/components/app/discovery/discovery-jobs-page";

export const metadata: Metadata = { title: "Discovery" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <DiscoveryJobsPage />
    </Suspense>
  );
}
