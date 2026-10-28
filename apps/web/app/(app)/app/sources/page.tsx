import type { Metadata } from "next";
import { SourcesPage } from "@/components/app/sources/sources-page";

export const metadata: Metadata = { title: "Sources" };

export default function Page() {
  return <SourcesPage />;
}
