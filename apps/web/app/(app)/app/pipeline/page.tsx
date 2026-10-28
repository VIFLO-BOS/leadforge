import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { PipelinePage } from "@/components/app/pipeline/pipeline-page";

export const metadata: Metadata = { title: "Lead pipeline" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <PipelinePage />
    </Suspense>
  );
}
