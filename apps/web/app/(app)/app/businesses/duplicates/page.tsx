import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { DuplicatesPage } from "@/components/app/dedup/duplicates-page";

export const metadata: Metadata = { title: "Duplicate review" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <DuplicatesPage />
    </Suspense>
  );
}
