import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The last answer stays on screen, dimmed and marked busy, while the next one loads (a new period
 * or filter): nothing jumps or flashes to a skeleton. One look for every such place.
 */
export function Refreshing({
  busy,
  className,
  children,
}: {
  busy: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      aria-busy={busy}
      className={cn(
        "transition-opacity motion-reduce:transition-none",
        busy && "opacity-60",
        className,
      )}
    >
      {children}
    </div>
  );
}
