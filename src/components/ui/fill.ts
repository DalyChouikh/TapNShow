import type { FillTone } from "@/design/tokens";

/**
 * The background class of each pastel fill (chips, stickers, pills). Written out in full so
 * Tailwind finds every class.
 */
export const FILL_CLASS: Record<FillTone, string> = {
  primary: "bg-fill-primary",
  success: "bg-fill-success",
  warning: "bg-fill-warning",
  danger: "bg-fill-danger",
  info: "bg-fill-info",
  neutral: "bg-fill-neutral",
};

/** The SVG fill class of each pastel fill (chart marks). Written out in full for Tailwind. */
export const SVG_FILL_CLASS: Record<FillTone, string> = {
  primary: "fill-fill-primary",
  success: "fill-fill-success",
  warning: "fill-fill-warning",
  danger: "fill-fill-danger",
  info: "fill-fill-info",
  neutral: "fill-fill-neutral",
};
