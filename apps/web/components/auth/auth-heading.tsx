import Link from "next/link";
import { LogoMark } from "@/components/marketing/logo";

/**
 * Google-account-style auth panel. Below 840px: mark, title, description and the form stacked in
 * one column. From 840px: the heading block on the left, the form on the right.
 */
export function AuthPanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-8 min-[840px]:grid-cols-2 min-[840px]:gap-14">
      <div className="flex min-w-0 flex-col gap-4">
        <Link href="/" aria-label="LeadForge home" className="self-start rounded-xl">
          <LogoMark className="size-11 rounded-xl" />
        </Link>
        <h1 className="break-anywhere text-2xl font-normal leading-8 tracking-[-0.015em] min-[840px]:mt-2 min-[840px]:text-[28px] min-[840px]:leading-9">
          {title}
        </h1>
        {description ? (
          <div className="text-foreground text-base leading-6">{description}</div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col min-[840px]:pt-[60px]">{children}</div>
    </div>
  );
}

/** Link-styled secondary action inside auth forms (Forgot password, Back to sign in). */
export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-primary rounded-xs self-start text-sm font-medium underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}
