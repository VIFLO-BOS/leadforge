export function AuthHeading({
  title,
  description,
}: {
  title: string;
  description?: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
      {description ? <p className="text-muted-foreground mt-1.5 text-sm">{description}</p> : null}
    </div>
  );
}
