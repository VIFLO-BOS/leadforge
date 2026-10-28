import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { BulkJobPage } from "@/components/app/bulk/bulk-job-page";

export const metadata: Metadata = { title: "Bulk operation" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <BulkJobPage id={id} />
    </Suspense>
  );
}
