import { cn } from "@leadforge/ui";

export function GallerySection({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id={`${id}-title`} className="text-xl font-normal leading-7 tracking-[-0.01em]">
          {title}
        </h2>
        {description ? (
          <p className="text-muted-foreground max-w-3xl text-sm">{description}</p>
        ) : null}
      </div>
      <div
        className={cn(
          "border-border bg-surface flex min-w-0 flex-col gap-6 rounded-lg border p-3 min-[360px]:p-4 sm:p-6",
          className,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function Demo({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <div className={cn("flex min-w-0 flex-wrap items-center gap-3", className)}>{children}</div>
    </div>
  );
}
