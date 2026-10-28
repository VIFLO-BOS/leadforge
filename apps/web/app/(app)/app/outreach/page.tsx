import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { OutreachPage } from "@/components/app/outreach/outreach-page";

export const metadata: Metadata = { title: "Outreach records" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <OutreachPage />
    </Suspense>
  );
}
