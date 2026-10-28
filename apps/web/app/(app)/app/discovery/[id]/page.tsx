import type { Metadata } from "next";
import { Suspense } from "react";
import {
  DiscoveryJobDetail,
  JobDetailSkeleton,
} from "@/components/app/discovery/detail/discovery-job-detail";

export const metadata: Metadata = { title: "Discovery job" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<JobDetailSkeleton />}>
      <DiscoveryJobDetail id={id} />
    </Suspense>
  );
}
