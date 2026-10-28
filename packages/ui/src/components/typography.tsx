"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../lib/cn";

/** Keyboard key. Use one Kbd per key: <Kbd>Ctrl</Kbd> <Kbd>K</Kbd>. */
export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "border-border-strong bg-surface text-muted-foreground rounded-xs inline-flex h-5 min-w-5 items-center justify-center border border-b-2 px-1 font-mono text-[11px] font-medium leading-none",
        className,
      )}
      {...props}
    />
  );
}

/** Inline technical value (IDs, domains). Wraps anywhere so it can never overflow at 240px. */
export function Code({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <code
      className={cn(
        "break-anywhere bg-surface-container-high text-foreground rounded-xs px-1 py-0.5 font-mono text-[13px]",
        className,
      )}
      {...props}
    />
  );
}

export interface CopyableValueProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  value: string;
  /** Accessible label for what is being copied, for example "organization ID". */
  label: string;
  /** Render as monospace (IDs, keys) or body text (emails, domains). */
  mono?: boolean;
  /** Shown instead of `value` (for example a formatted phone number). The copy uses `value`. */
  display?: React.ReactNode;
}

/**
 * A long token shown in full (overflow-wrap: anywhere, never truncated) with a copy button that
 * confirms through a polite live region.
 */
export function CopyableValue({
  value,
  label,
  mono = true,
  display,
  className,
  ...props
}: CopyableValueProps) {
  const [copied, setCopied] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);

  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className={cn("flex min-w-0 items-start gap-1", className)} {...props}>
      <span
        className={cn(
          "break-anywhere text-foreground min-w-0 flex-1 py-1.5",
          mono ? "font-mono text-[13px] leading-5" : "text-sm leading-5",
        )}
      >
        {display ?? value}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${label}`}
        className="state-layer text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full"
      >
        {copied ? (
          <Check aria-hidden className="text-success size-4" />
        ) : (
          <Copy aria-hidden className="size-4" />
        )}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? `Copied ${label}` : failed ? `Could not copy ${label}` : ""}
      </span>
    </div>
  );
}
