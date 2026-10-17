"use client";

import { useFormatter, useTranslations } from "next-intl";
import { deliveredPercent } from "@/lib/admin/format";

/**
 * Numbers in the admin area: counts with separators (or short, for a chart's scale), percents
 * with up to one decimal, and the "98.7% delivered" line.
 */
export function useAdminFormat() {
  const format = useFormatter();
  const t = useTranslations("Admin");
  /** `98.6` → "98.6%"; null (nothing to measure) → "–". */
  const percent = (value: number | null) =>
    value === null
      ? t("noValue")
      : format.number(value / 100, {
          style: "percent",
          maximumFractionDigits: 1,
        });
  return {
    /** `9870` → "9,870". */
    count: (value: number) => format.number(value),
    /** `9870` → "9.9K": short enough for a chart's scale on a phone. */
    compact: (value: number) =>
      format.number(value, { notation: "compact", maximumFractionDigits: 1 }),
    percent,
    /** "98.7% delivered" from what arrived and what was tried; "none sent" when nothing was. */
    delivered: (arrived: number, tried: number) => {
      const rate = deliveredPercent(arrived, tried);
      return rate === null
        ? t("figures.noneSent")
        : t("deliveredRate", { rate: percent(rate) });
    },
  };
}
