import { palette, shape } from "@/design/tokens";

const px = (value: string): number => Number.parseFloat(value);

/**
 * Email-safe Soft Neobrutalism tokens. Light palette only: many clients ignore
 * `prefers-color-scheme` or recolor dark mode themselves. Borders are whole pixels, and
 * the hard shadow is drawn as thicker right/bottom borders because Gmail's mobile apps drop
 * `box-shadow` for Google accounts (caniemail).
 */
export const emailTheme = {
  background: palette.light.background,
  surface: palette.light.surface,
  ink: palette.light.ink,
  muted: palette.light.muted,
  outline: palette.light.outline,
  primary: palette.light.primary,
  warning: palette.light.warning,
  success: palette.light.success,
  danger: palette.light.danger,
  border: `${Math.ceil(px(shape.borderWidth))}px`,
  shadowBorder: `${Math.ceil(px(shape.borderWidth)) + px(shape.shadow)}px`,
  radiusCard: shape.radiusCard,
  radiusControl: shape.radiusControl,
  radiusSticker: shape.radiusSticker,
  fontBody: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  fontDisplay: "'Arial Black', 'Helvetica Neue', Arial, sans-serif",
  fontCode: "'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace",
} as const;

/** Outlined block with the border-drawn hard shadow (cards, code boxes, buttons). */
export function brutalBox(
  fill: string,
  radius: string,
): Record<string, string> {
  return {
    backgroundColor: fill,
    border: `${emailTheme.border} solid ${emailTheme.outline}`,
    borderRightWidth: emailTheme.shadowBorder,
    borderBottomWidth: emailTheme.shadowBorder,
    borderRadius: radius,
  };
}

/**
 * Hidden in the HTML view but kept in the plain-text part and read by screen readers (the
 * preheader technique react-email's `Preview` uses). Labels "Before:" / "Now:" next to a
 * strike-through so the meaning survives without styles.
 */
export const hiddenStyle = {
  display: "none",
  maxHeight: 0,
  overflow: "hidden",
  msoHide: "all",
} as const;
