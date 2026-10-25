import Link from "next/link";
import { Button } from "@leadforge/ui";

export default function NotFound() {
  return (
    <main
      id="main"
      className="page-pad flex min-h-dvh flex-col items-center justify-center gap-4 text-center"
    >
      <p className="text-muted-foreground font-mono text-xs">404</p>
      <h1 className="text-h2 font-semibold">Page not found</h1>
      <p className="text-muted-foreground max-w-prose">
        The page you asked for does not exist or has moved.
      </p>
      <div className="xs:flex-row flex flex-col gap-2">
        <Button asChild>
          <Link href="/">Back to home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/app">Open dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
