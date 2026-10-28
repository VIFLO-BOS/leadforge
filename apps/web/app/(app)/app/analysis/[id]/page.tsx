import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalysisDetail, AnalysisDetailSkeleton } from "@/components/app/analysis/analysis-detail";

export const metadata: Metadata = { title: "Website analysis" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<AnalysisDetailSkeleton />}>
      <AnalysisDetail id={id} />
    </Suspense>
  );
}
