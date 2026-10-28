import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { ActivitiesPage } from "@/components/app/activities/activities-page";

export const metadata: Metadata = { title: "Activities" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <ActivitiesPage />
    </Suspense>
  );
}
