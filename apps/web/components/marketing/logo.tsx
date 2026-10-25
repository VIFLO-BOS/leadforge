import Link from "next/link";
import { cn } from "@leadforge/ui";
import { SITE_NAME } from "@/lib/site";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-md",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 19 12 5l7 14" />
        <path d="M8.5 13.5h7" />
      </svg>
    </span>
  );
}

/** Mark-only below 320px, mark plus wordmark above. */
export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn("flex min-w-0 items-center gap-2 rounded-md", className)}
      aria-label={`${SITE_NAME} home`}
    >
      <LogoMark />
      <span className="hidden truncate text-base font-semibold tracking-tight min-[320px]:inline">
        {SITE_NAME}
      </span>
    </Link>
  );
}
