import { PageTransition } from "@leadforge/ui";

/** Remounts on every marketing navigation: fade plus rise, skipped on the first load. */
export default function MarketingTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
