import Link from "next/link";

/**
 * Centred auth surface. Under 480px the form sits directly on the surface (no card), as on
 * phone-sized account pages; from 480px it is a 28px-radius card on the tinted page.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface min-[480px]:bg-surface-container-low dark:min-[480px]:bg-background flex min-h-dvh flex-col">
      <main
        id="main"
        className="flex flex-1 items-start justify-center min-[480px]:items-center min-[480px]:px-6 min-[480px]:py-10"
      >
        <div className="bg-surface w-full max-w-[480px] px-[var(--page-pad)] py-8 [--field-bg:var(--surface)] min-[480px]:rounded-2xl min-[480px]:p-10 min-[840px]:max-w-[1040px] min-[840px]:p-12">
          {children}
        </div>
      </main>
      <footer className="page-pad mx-auto flex w-full max-w-[1040px] flex-wrap items-center justify-center gap-x-1 gap-y-1 pb-6 min-[480px]:justify-end">
        {[
          { href: "/legal/privacy", label: "Privacy" },
          { href: "/legal/terms", label: "Terms" },
          { href: "/contact", label: "Help" },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="state-layer text-muted-foreground rounded-full px-3 py-2 text-xs font-medium"
          >
            {l.label}
          </Link>
        ))}
      </footer>
    </div>
  );
}
