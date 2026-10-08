"use client";

import type { ReactNode } from "react";
import type { FillTone } from "@/design/tokens";
import { cn } from "@/lib/utils";

const PRESSED_FILL: Record<FillTone, string> = {
  primary: "bg-fill-primary",
  success: "bg-fill-success",
  warning: "bg-fill-warning",
  danger: "bg-fill-danger",
  info: "bg-fill-info",
  neutral: "bg-fill-neutral",
};

/** Pill-shaped toggle (e.g. delay options). Selected chips take their tone's fill. */
export function Chip({
  pressed,
  onPressedChange,
  tone = "primary",
  className,
  children,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  tone?: FillTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border-[length:var(--tn-border-width)] border-outline px-4 text-sm font-bold shadow-brutal-sm transition-transform duration-300 ease-spring active:translate-y-0.5 active:shadow-none motion-reduce:transition-none",
        pressed
          ? cn(PRESSED_FILL[tone], "text-on-fill")
          : "bg-surface text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}
