"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { MotionConfig } from "framer-motion";
import { Toaster, TooltipProvider } from "@leadforge/ui";
import { SessionWatcher } from "@/components/session-watcher";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 15_000 },
        },
      }),
  );

  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {/* framer-motion honours prefers-reduced-motion for anything not already gated. */}
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={client}>
          <SessionWatcher />
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          <Toaster />
        </QueryClientProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
