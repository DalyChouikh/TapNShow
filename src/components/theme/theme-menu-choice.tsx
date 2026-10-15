"use client";

import { CircleHalf } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { useIsClient } from "@/lib/use-is-client";
import { isThemeMode, THEME_ICONS, THEME_MODES } from "./theme-modes";

/**
 * "Theme" in the user menu (spec §10): System, Light, Dark as one segmented row. Choosing keeps
 * the menu open so the change is visible.
 */
export function ThemeMenuChoice() {
  const t = useTranslations("Theme");
  const { theme, setTheme } = useTheme();
  const mounted = useIsClient();
  const current = mounted && isThemeMode(theme) ? theme : "system";
  return (
    <div className="px-1.5 pt-1 pb-1.5">
      <p className="flex items-center gap-2 px-1.5 pb-1 text-xs font-bold text-muted-ink">
        <CircleHalf weight="bold" aria-hidden className="size-4" />
        <span id="theme-menu-label">{t("menuLabel")}</span>
      </p>
      <DropdownMenuRadioGroup
        aria-labelledby="theme-menu-label"
        value={current}
        onValueChange={(value) => {
          if (isThemeMode(value)) {
            setTheme(value);
          }
        }}
        className="flex gap-1 rounded-control border-[length:var(--tn-border-width)] border-outline p-1"
      >
        {THEME_MODES.map((mode) => {
          const Glyph = THEME_ICONS[mode];
          return (
            <DropdownMenuRadioItem
              key={mode}
              value={mode}
              onSelect={(event) => event.preventDefault()}
            >
              <Glyph weight="bold" aria-hidden />
              {t(`choices.${mode}`)}
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
    </div>
  );
}
