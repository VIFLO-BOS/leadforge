import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { BillingPage } from "@/components/app/billing/billing-page";

export const metadata: Metadata = { title: "Billing" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-lg" />}>
      <BillingPage />
    </Suspense>
  );
}
