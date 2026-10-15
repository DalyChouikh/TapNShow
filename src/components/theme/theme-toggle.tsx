"use client";

import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useIsClient } from "@/lib/use-is-client";
import { cn } from "@/lib/utils";
import {
  isThemeMode,
  THEME_ICONS,
  THEME_MODES,
  type ThemeMode,
} from "./theme-modes";

/** Cycles the color theme: system -> light -> dark. */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("Theme");
  const { theme, setTheme } = useTheme();
  const mounted = useIsClient();

  const current: ThemeMode = mounted && isThemeMode(theme) ? theme : "system";
  const next =
    THEME_MODES[(THEME_MODES.indexOf(current) + 1) % THEME_MODES.length];
  const Icon = THEME_ICONS[current];

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={t("toggle", { mode: t(current) })}
      className={cn(
        "inline-flex size-11 items-center justify-center rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface text-ink shadow-brutal transition-transform ease-spring active:translate-y-1 active:shadow-none motion-reduce:transition-none",
        className,
      )}
    >
      <Icon weight="bold" size={20} aria-hidden />
    </button>
  );
}
