import Link from "next/link";
import { Button } from "@leadforge/ui";
import { Logo } from "@/components/marketing/logo";

export default function NotFound() {
  return (
    <div className="bg-surface min-[480px]:bg-surface-container-low dark:min-[480px]:bg-background flex min-h-dvh flex-col">
      <header className="page-pad flex h-16 items-center">
        <Logo />
      </header>
      <main
        id="main"
        className="flex flex-1 items-start justify-center min-[480px]:items-center min-[480px]:px-6 min-[480px]:py-10"
      >
        <div className="bg-surface flex w-full max-w-[560px] flex-col items-start gap-4 px-[var(--page-pad)] py-8 min-[480px]:rounded-2xl min-[480px]:p-10">
          <p className="text-primary font-mono text-sm font-medium">404</p>
          <h1 className="text-2xl font-normal leading-8 tracking-[-0.015em] sm:text-[28px] sm:leading-9">
            Page not found
          </h1>
          <p className="text-muted-foreground text-base">
            The page you asked for does not exist or has moved.
          </p>
          <div className="mt-2 flex w-full flex-col gap-2 min-[360px]:w-auto min-[360px]:flex-row">
            <Button asChild>
              <Link href="/">Back to home</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/app">Open dashboard</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
