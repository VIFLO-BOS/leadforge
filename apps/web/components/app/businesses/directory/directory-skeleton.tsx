import { Skeleton } from "@leadforge/ui";

/** Matches the directory layout so the first paint does not jump. */
export function DirectorySkeleton() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-busy="true"
      aria-label="Loading businesses"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-48 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-10 w-full max-w-sm rounded-full" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="hidden h-8 w-24 rounded-full md:block" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-lg" />
    </div>
  );
}
