"use client";

import { useEffect } from "react";
import { ErrorState } from "@leadforge/ui";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="page-pad flex min-h-dvh items-center justify-center">
      <div className="w-full max-w-md">
        <ErrorState
          title="This page failed to load"
          message="An unexpected error interrupted rendering. You can try again; if it keeps happening, contact support with the reference below."
          requestId={error.digest}
          onRetry={reset}
        />
      </div>
    </main>
  );
}
