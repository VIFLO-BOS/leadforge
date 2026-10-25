import { Reveal, cn } from "@leadforge/ui";

export function Section({
  id,
  eyebrow,
  title,
  description,
  children,
  className,
  tone = "default",
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
  tone?: "default" | "surface";
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cn(
        "scroll-mt-20 py-12 md:py-20",
        tone === "surface" && "border-border bg-surface border-y",
        className,
      )}
    >
      <div className="container-marketing">
        <Reveal>
          <div className="max-w-2xl">
            {eyebrow ? (
              <p className="text-primary mb-2 text-xs font-semibold uppercase tracking-wider">
                {eyebrow}
              </p>
            ) : null}
            <h2
              id={id ? `${id}-title` : undefined}
              className="text-h2 font-semibold tracking-tight"
            >
              {title}
            </h2>
            {description ? (
              <p className="text-body-lg text-muted-foreground mt-3">{description}</p>
            ) : null}
          </div>
        </Reveal>
        {children ? <div className="mt-8 md:mt-12">{children}</div> : null}
      </div>
    </section>
  );
}

export function FeatureGrid({
  items,
}: {
  items: { title: string; body: string; icon?: React.ReactNode }[];
}) {
  return (
    <ul className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item, i) => (
        <Reveal key={item.title} delay={Math.min(i * 0.05, 0.25)}>
          <li className="border-border bg-surface h-full min-w-0 rounded-lg border p-5">
            {item.icon ? <div className="text-primary mb-3 [&_svg]:size-5">{item.icon}</div> : null}
            <h3 className="text-base font-semibold">{item.title}</h3>
            <p className="text-muted-foreground mt-1.5 text-sm">{item.body}</p>
          </li>
        </Reveal>
      ))}
    </ul>
  );
}
