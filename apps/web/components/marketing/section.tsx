import { Reveal, cn } from "@leadforge/ui";

export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-primary text-[13px] font-medium leading-5 tracking-[0.01em] sm:text-sm",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Section heading block: eyebrow, h2 and lead paragraph. Reveals once on scroll. */
export function SectionHeader({
  id,
  eyebrow,
  title,
  description,
  align = "start",
  className,
}: {
  id?: string;
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "start" | "center";
  className?: string;
}) {
  return (
    <Reveal
      className={cn(
        "flex max-w-3xl flex-col gap-4",
        align === "center" && "mx-auto items-center text-center",
        className,
      )}
    >
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 id={id ? `${id}-title` : undefined} className="text-h2 text-balance">
        {title}
      </h2>
      {description ? (
        <p className="text-body-lg text-muted-foreground max-w-2xl">{description}</p>
      ) : null}
    </Reveal>
  );
}

/** Page section with the marketing rhythm: 64px mobile, 96 to 128px desktop. */
export function Section({
  id,
  eyebrow,
  title,
  description,
  children,
  className,
  headerAlign = "start",
  tone = "default",
}: {
  id?: string;
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  headerAlign?: "start" | "center";
  tone?: "default" | "tint";
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cn(
        "py-16 sm:py-24 lg:py-32",
        tone === "tint" && "bg-surface-container-low",
        className,
      )}
    >
      <div className="container-marketing">
        <SectionHeader
          id={id}
          eyebrow={eyebrow}
          title={title}
          description={description}
          align={headerAlign}
        />
        {children ? <div className="mt-10 sm:mt-14 lg:mt-16">{children}</div> : null}
      </div>
    </section>
  );
}

/** Small page hero for inner pages (Product, Pricing, About, Contact). Server-rendered, no motion. */
export function PageHero({
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("container-marketing pb-12 pt-12 sm:pb-16 sm:pt-20 lg:pt-28", className)}
    >
      <div className="flex max-w-4xl flex-col gap-5">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="text-h1 text-balance">{title}</h1>
        {description ? (
          <p className="text-body-lg text-muted-foreground max-w-2xl">{description}</p>
        ) : null}
        {children}
      </div>
    </section>
  );
}
