import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { ListDetail } from "@/components/app/lists/list-detail";

export const metadata: Metadata = { title: "Lead list" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <ListDetail id={id} />
    </Suspense>
  );
}
