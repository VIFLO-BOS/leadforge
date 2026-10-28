import Link from "next/link";
import { FOOTER_COLUMNS, SITE_NAME } from "@/lib/site";
import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="bg-surface-container-low">
      <div className="container-marketing py-14 md:py-20">
        <div className="grid min-w-0 grid-cols-1 gap-10 min-[480px]:grid-cols-2 lg:grid-cols-[1.6fr_repeat(4,1fr)] lg:gap-8">
          <div className="flex min-w-0 flex-col gap-4 min-[480px]:col-span-2 lg:col-span-1">
            <Logo />
            <p className="text-muted-foreground max-w-xs text-sm leading-6">
              Business discovery and lead intelligence with provenance you can inspect. Built first
              for Nigeria.
            </p>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title} className="min-w-0">
              <h2 className="text-foreground text-sm font-medium">{col.title}</h2>
              <ul className="mt-4 flex flex-col gap-3">
                {col.links.map((link) => (
                  <li key={link.href + link.label}>
                    <Link
                      href={link.href}
                      className="break-anywhere text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="border-border text-muted-foreground mt-14 flex flex-col gap-3 border-t pt-6 text-[13px] min-[640px]:flex-row min-[640px]:items-center min-[640px]:justify-between">
          <p>
            &copy; {new Date().getFullYear()} {SITE_NAME}. All rights reserved.
          </p>
          <p>Data is collected only from permitted sources and shown with its origin.</p>
        </div>
      </div>
    </footer>
  );
}
