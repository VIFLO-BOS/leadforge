import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { ReportsPage } from "@/components/app/reports/reports-page";

export const metadata: Metadata = { title: "Reports" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <ReportsPage />
    </Suspense>
  );
}
