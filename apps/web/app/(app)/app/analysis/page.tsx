import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { AnalysesPage } from "@/components/app/analysis/analyses-page";

export const metadata: Metadata = { title: "Website analysis" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <AnalysesPage />
    </Suspense>
  );
}
