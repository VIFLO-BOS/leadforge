import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { JobsPage } from "@/components/app/jobs/jobs-page";

export const metadata: Metadata = { title: "Background jobs" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <JobsPage />
    </Suspense>
  );
}
