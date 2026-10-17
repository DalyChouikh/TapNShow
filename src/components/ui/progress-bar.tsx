import { cn } from "@/lib/utils";

/** An outlined bar filled to `value` of `max` (sending, answers, setup steps). */
export function ProgressBar({
  label,
  value,
  max,
  className,
}: {
  /** What it measures, for screen readers. */
  label: string;
  value: number;
  max: number;
  className?: string;
}) {
  const now = Math.min(Math.max(value, 0), max);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={now}
      className={cn(
        "h-4 overflow-hidden rounded-full border-[length:var(--tn-border-width)] border-outline bg-surface",
        className,
      )}
    >
      <div
        className={cn(
          "h-full border-outline bg-fill-primary transition-[width] motion-reduce:transition-none",
          // The divider between filled and empty; none when the bar is empty or full.
          now > 0 && now < max && "border-r-[length:var(--tn-border-width)]",
        )}
        style={{ width: `${max > 0 ? (now / max) * 100 : 0}%` }}
      />
    </div>
  );
}
