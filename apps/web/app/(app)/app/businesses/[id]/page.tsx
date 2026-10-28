import type { Metadata } from "next";
import { Suspense } from "react";
import { BusinessDetail, DetailSkeleton } from "@/components/app/businesses/detail/business-detail";

export const metadata: Metadata = { title: "Business" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <BusinessDetail id={id} />
    </Suspense>
  );
}
