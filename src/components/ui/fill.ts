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
