"use client";

import { DesktopIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

const ORDER = ["system", "light", "dark"] as const;
type Mode = (typeof ORDER)[number];

const ICONS: Record<Mode, typeof SunIcon> = {
  system: DesktopIcon,
  light: SunIcon,
  dark: MoonIcon,
};

const noopSubscribe = () => () => undefined;

/** False during SSR/hydration, true on the client — avoids theme hydration mismatch. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function isMode(value: string | undefined): value is Mode {
  return ORDER.some((mode) => mode === value);
}

/** Cycles the color theme: system -> light -> dark. */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("Theme");
  const { theme, setTheme } = useTheme();
  const mounted = useIsClient();

  const current: Mode = mounted && isMode(theme) ? theme : "system";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const Icon = ICONS[current];

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
