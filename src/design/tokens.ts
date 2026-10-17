/** Theme names supported by the design system. */
export const THEMES = ["light", "dark"] as const;

/** A supported theme name. */
export type ThemeName = (typeof THEMES)[number];

/** Pastel fill tones used by buttons, stickers, chips and status badges. */
export const FILL_TONES = [
  "primary",
  "success",
  "warning",
  "danger",
  "info",
  "neutral",
] as const;

/** A pastel fill tone. */
export type FillTone = (typeof FILL_TONES)[number];

/** The smallest tap target, in CSS pixels (AGENTS.md: at least 44 px). */
export const MIN_TAP_TARGET_PX = 44;

/**
 * The tone of each attendance outcome: Going, Late, Absent, No reply (the meeting page's tiles, a
 * person's history counts, Home's chart).
 */
export const OUTCOME_TONES = {
  attending: "success",
  late: "warning",
  absent: "danger",
  noReply: "neutral",
} as const satisfies Record<string, FillTone>;

/** An attendance outcome, as the counts name it. */
export type Outcome = keyof typeof OUTCOME_TONES;

/**
 * Every color a theme must define (hex). `onFill` is the text color on any pastel fill;
 * `onFillMuted` is secondary text on a fill (e.g. a placeholder in an invalid input).
 */
export type ThemeColors = {
  background: string;
  surface: string;
  ink: string;
  muted: string;
  outline: string;
  onFill: string;
  onFillMuted: string;
} & Record<FillTone, string>;

/** Soft Neobrutalism palette. Fills stay light in dark mode so dark ink remains readable. */
export const palette: Record<ThemeName, ThemeColors> = {
  light: {
    background: "#F3EEFF",
    surface: "#FFFFFF",
    ink: "#1E1B2E",
    muted: "#5B5670",
    outline: "#1E1B2E",
    onFill: "#1E1B2E",
    onFillMuted: "#3F3A52",
    primary: "#C4B5FD",
    success: "#BBF7D0",
    warning: "#FDE68A",
    danger: "#FECACA",
    info: "#BAE6FD",
    neutral: "#E5E7EB",
  },
  dark: {
    background: "#16131F",
    surface: "#221E30",
    ink: "#F4F1FF",
    muted: "#B7B0CC",
    outline: "#F4F1FF",
    onFill: "#1E1B2E",
    onFillMuted: "#3F3A52",
    primary: "#C4B5FD",
    success: "#86EFAC",
    warning: "#FCD34D",
    danger: "#FCA5A5",
    info: "#7DD3FC",
    neutral: "#CBD5E1",
  },
};

/** Shape tokens: thick outlines, rounded corners, hard downward shadows. */
export const shape = {
  borderWidth: "2.5px",
  radiusSticker: "10px",
  radiusControl: "16px",
  radiusCard: "20px",
  shadowSm: "2px",
  shadow: "4px",
  shadowLg: "6px",
} as const;

/** Overshooting spring curve for CSS transitions (matches the Expressive motion style). */
export const EASE_SPRING_CSS = "cubic-bezier(0.34, 1.56, 0.64, 1)";
