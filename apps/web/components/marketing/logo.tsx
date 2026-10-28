import Link from "next/link";
import { cn } from "@leadforge/ui";
import { SITE_NAME } from "@/lib/site";

/**
 * LeadForge mark: a rounded tile in Forge Cobalt with an "L" stroke meeting a found point,
 * the lead the product surfaces. Decorative; the accessible name lives on the link.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-[10px]",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[18px]" fill="none">
        <path
          d="M7 5.5v9.25A3.25 3.25 0 0 0 10.25 18H17"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="16.25" cy="8.25" r="2.75" fill="currentColor" />
      </svg>
    </span>
  );
}

/** Mark-only below 320px, mark plus wordmark above. */
export function Logo({
  href = "/",
  className,
  label,
}: {
  href?: string;
  className?: string;
  /** Accessible name; defaults to "LeadForge home". */
  label?: string;
}) {
  return (
    <Link
      href={href}
      className={cn("flex min-w-0 items-center gap-2.5 rounded-full", className)}
      aria-label={label ?? `${SITE_NAME} home`}
    >
      <LogoMark />
      <span className="hidden truncate text-[19px] font-medium leading-none tracking-[-0.02em] min-[320px]:inline">
        {SITE_NAME}
      </span>
    </Link>
  );
}
