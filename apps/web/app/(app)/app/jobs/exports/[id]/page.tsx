import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { ExportJobPage } from "@/components/app/exports/export-job-page";

export const metadata: Metadata = { title: "Export" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <ExportJobPage id={id} />
    </Suspense>
  );
}
