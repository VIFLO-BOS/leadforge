import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { UsagePage } from "@/components/app/usage/usage-page";

export const metadata: Metadata = { title: "Usage and credits" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <UsagePage />
    </Suspense>
  );
}
