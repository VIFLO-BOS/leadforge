import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@leadforge/ui";
import { SettingsPage } from "@/components/app/settings/settings-page";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <SettingsPage />
    </Suspense>
  );
}
