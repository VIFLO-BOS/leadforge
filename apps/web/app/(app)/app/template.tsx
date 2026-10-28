import { PageTransition } from "@leadforge/ui";

/** Remounts on every dashboard navigation inside the persistent shell: fade plus rise. */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition className="min-w-0">{children}</PageTransition>;
}
