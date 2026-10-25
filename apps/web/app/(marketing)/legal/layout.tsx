import Link from "next/link";
import { Badge } from "@leadforge/ui";

const LEGAL_LINKS = [
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/acceptable-use", label: "Acceptable use" },
  { href: "/legal/data-collection", label: "Data collection" },
];

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="container-prose py-12 md:py-16">
      <nav
        aria-label="Legal documents"
        className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto pb-4"
      >
        {LEGAL_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="text-muted-foreground hover:bg-muted hover:text-foreground shrink-0 rounded-md px-3 py-2 text-sm"
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge variant="warning">Draft</Badge>
        <p className="text-muted-foreground text-xs">
          Pending legal review. Last updated 24 October 2026.
        </p>
      </div>
      <article className="prose-legal min-w-0">{children}</article>
    </div>
  );
}
