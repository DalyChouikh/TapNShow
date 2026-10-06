import { cn } from "@/lib/utils";

/** Style-B loading block: outlined, muted fill, gentle pulse (none for reduced motion). Hidden from assistive tech. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-control border-[length:var(--tn-border-width)] border-outline bg-fill-neutral motion-reduce:animate-none",
        className,
      )}
    />
  );
}
