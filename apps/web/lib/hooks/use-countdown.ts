"use client";

import { useEffect, useState } from "react";
import { isApiError } from "../api";

/** Seconds left until `until` (epoch ms), ticking once a second; 0 when passed or null. */
export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null || until <= Date.now()) return;
    setNow(Date.now());
    const t = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= until) window.clearInterval(t);
    }, 1_000);
    return () => window.clearInterval(t);
  }, [until]);
  if (until === null) return 0;
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * For a 429 RATE_LIMITED error with a Retry-After header: the moment the request may be tried
 * again, measured from when the error arrived (`receivedAt`). Null for any other error.
 */
export function retryAtFor(err: unknown, receivedAt: number): number | null {
  if (!isApiError(err) || err.code !== "RATE_LIMITED") return null;
  return receivedAt + (err.retryAfter ?? 60) * 1000;
}
