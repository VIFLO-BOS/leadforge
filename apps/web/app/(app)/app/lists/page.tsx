import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { ListsPage } from "@/components/app/lists/lists-page";

export const metadata: Metadata = { title: "Lead lists" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <ListsPage />
    </Suspense>
  );
}
