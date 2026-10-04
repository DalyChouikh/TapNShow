import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Outlined surface container with the hard Neobrutalist shadow. */
export function Card({
  as: Component = "div",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article" }) {
  return (
    <Component
      className={cn(
        "rounded-card border-[length:var(--tn-border-width)] border-outline bg-surface p-4 text-ink shadow-brutal",
        className,
      )}
      {...props}
    />
  );
}
