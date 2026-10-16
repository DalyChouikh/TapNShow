import { Skeleton } from "@/components/ui/skeleton";

const PLACEHOLDER_CARDS = 5;

/** Style-B loading state of the roster page. */
export function RosterSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy>
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-2/3" />
      {Array.from({ length: PLACEHOLDER_CARDS }, (_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}
