import type { ReactNode } from "react";
import type { FillTone } from "@/design/tokens";
import { cn } from "@/lib/utils";
import { FILL_CLASS } from "./fill";

/** A small rounded status label in a tone's fill (an answer, a sheet's state). Not interactive. */
export function Pill({
  tone,
  className,
  children,
}: {
  tone: FillTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full border-2 border-outline px-2 text-xs font-bold text-on-fill",
        FILL_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
