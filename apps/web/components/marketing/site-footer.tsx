import Link from "next/link";
import { FOOTER_COLUMNS, SITE_NAME } from "@/lib/site";
import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="border-border bg-surface border-t">
      <div className="container-marketing py-10 md:py-14">
        <div className="grid min-w-0 grid-cols-1 gap-8 min-[480px]:grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="min-w-0 min-[480px]:col-span-2 lg:col-span-1">
            <Logo />
            <p className="text-muted-foreground mt-3 max-w-xs text-sm">
              Business discovery and lead intelligence with provenance you can inspect. Built first
              for Nigeria.
            </p>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title} className="min-w-0">
              <h2 className="text-sm font-semibold">{col.title}</h2>
              <ul className="mt-3 flex flex-col gap-2">
                {col.links.map((link) => (
                  <li key={link.href + link.label}>
                    <Link
                      href={link.href}
                      className="break-anywhere text-muted-foreground hover:text-foreground text-sm"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="border-border text-muted-foreground mt-10 flex flex-col gap-2 border-t pt-6 text-xs min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
          <p>
            &copy; {new Date().getFullYear()} {SITE_NAME}. All rights reserved.
          </p>
          <p>Data is collected only from permitted sources and shown with its origin.</p>
        </div>
      </div>
    </footer>
  );
}
