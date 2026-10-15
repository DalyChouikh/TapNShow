import {
  DesktopIcon,
  MoonIcon,
  SunIcon,
  type Icon,
} from "@phosphor-icons/react";

/** The colour themes, in the order every switch shows them (spec §10 Theme). */
export const THEME_MODES = ["system", "light", "dark"] as const;

/** One colour theme (`next-themes` value). */
export type ThemeMode = (typeof THEME_MODES)[number];

/** The icon of each theme, shared by the round switch and the menu. */
export const THEME_ICONS: Record<ThemeMode, Icon> = {
  system: DesktopIcon,
  light: SunIcon,
  dark: MoonIcon,
};

/** Whether `next-themes`' stored value is one of ours (it may be anything a browser kept). */
export function isThemeMode(value: string | undefined): value is ThemeMode {
  return THEME_MODES.some((mode) => mode === value);
}
