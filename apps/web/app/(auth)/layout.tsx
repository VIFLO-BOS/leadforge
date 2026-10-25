import Link from "next/link";
import { Logo } from "@/components/marketing/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <header className="page-pad flex h-14 items-center">
        <Logo />
      </header>
      <main
        id="main"
        className="page-pad flex flex-1 items-start justify-center py-6 sm:items-center sm:py-12"
      >
        <div className="border-border bg-surface w-full min-w-0 max-w-md rounded-lg border p-5 sm:p-8">
          {children}
        </div>
      </main>
      <footer className="page-pad text-muted-foreground flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-6 text-xs">
        <Link href="/legal/privacy" className="hover:text-foreground">
          Privacy
        </Link>
        <Link href="/legal/terms" className="hover:text-foreground">
          Terms
        </Link>
        <Link href="/contact" className="hover:text-foreground">
          Help
        </Link>
      </footer>
    </div>
  );
}
