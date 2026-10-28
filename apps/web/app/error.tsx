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
    <main
      id="main"
      className="page-pad bg-surface-container-low dark:bg-background flex min-h-dvh items-center justify-center"
    >
      <div className="bg-surface flex w-full max-w-md flex-col gap-4 rounded-2xl p-6 sm:p-8">
        <h1 className="text-xl font-normal leading-7">This page failed to load</h1>
        <ErrorState
          title="Something interrupted rendering"
          message="An unexpected error interrupted this page. You can try again; if it keeps happening, contact support with the reference below."
          requestId={error.digest}
          onRetry={reset}
        />
      </div>
    </main>
  );
}
