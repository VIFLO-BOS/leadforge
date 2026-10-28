import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { ImportWizard } from "@/components/app/businesses/import/import-wizard";

export const metadata: Metadata = { title: "Import businesses" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <ImportWizard />
    </Suspense>
  );
}
