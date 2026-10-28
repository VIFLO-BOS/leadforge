import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { BillingReturnPage } from "@/components/app/billing/billing-return-page";

export const metadata: Metadata = { title: "Payment" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <BillingReturnPage />
    </Suspense>
  );
}
