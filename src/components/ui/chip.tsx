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

/**
 * Pill-shaped toggle (e.g. delay options). Selected chips take their tone's fill. With
 * `role="radio"` it is one choice of a radiogroup (`aria-checked` instead of `aria-pressed`).
 */
export function Chip({
  pressed,
  onPressedChange,
  tone = "primary",
  role,
  disabled = false,
  className,
  children,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  tone?: FillTone;
  role?: "radio";
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-pressed={role ? undefined : pressed}
      aria-checked={role ? pressed : undefined}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border-[length:var(--tn-border-width)] border-outline px-4 text-sm font-bold shadow-brutal-sm transition-transform duration-300 ease-spring active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none",
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
