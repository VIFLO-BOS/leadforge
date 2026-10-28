import { Parallax, cn } from "@leadforge/ui";

const TONES = {
  primary: "bg-primary-container",
  tertiary: "bg-tertiary-container",
  neutral: "bg-surface-container-high",
} as const;

/**
 * Large media card: a tonal media well whose inner mock drifts against scroll (Parallax, static
 * under reduced motion), above a title and body. Hover lifts the card 4px on emphasized easing.
 */
export function ParallaxMediaCard({
  eyebrow,
  title,
  body,
  media,
  tone = "primary",
  className,
}: {
  eyebrow?: string;
  title: string;
  body: React.ReactNode;
  media: React.ReactNode;
  tone?: keyof typeof TONES;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "bg-surface-container-low ease-emphasized group flex h-full min-w-0 flex-col overflow-hidden rounded-[28px] transition-transform duration-300 hover:-translate-y-1 motion-reduce:transform-none",
        className,
      )}
    >
      <div className={cn("relative h-64 overflow-hidden sm:h-72", TONES[tone])}>
        <Parallax distance={56} className="absolute inset-x-5 top-8 sm:inset-x-8">
          <div className="bg-surface shadow-2 ease-emphasized overflow-hidden rounded-2xl transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transform-none">
            {media}
          </div>
        </Parallax>
      </div>
      <div className="flex flex-col gap-2 p-6 sm:p-8">
        {eyebrow ? <p className="text-primary text-[13px] font-medium">{eyebrow}</p> : null}
        <h3 className="text-lg font-normal leading-snug">{title}</h3>
        <div className="text-muted-foreground text-sm leading-relaxed">{body}</div>
      </div>
    </article>
  );
}
