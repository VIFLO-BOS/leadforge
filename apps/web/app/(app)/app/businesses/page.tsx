import type { Metadata } from "next";
import { Suspense } from "react";
import { BusinessDirectory } from "@/components/app/businesses/directory/business-directory";
import { DirectorySkeleton } from "@/components/app/businesses/directory/directory-skeleton";

export const metadata: Metadata = { title: "Businesses" };

export default function Page() {
  return (
    <Suspense fallback={<DirectorySkeleton />}>
      <BusinessDirectory />
    </Suspense>
  );
}
