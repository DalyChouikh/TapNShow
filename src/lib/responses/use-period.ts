"use client";

import { TZDate } from "@date-fns/tz";
import { format, subDays } from "date-fns";
import { useState } from "react";
import { HISTORY_DEFAULT_PERIOD } from "@/config/responses";
import { type HistoryPeriod, periodRange } from "./periods";

/**
 * Period chip state for history screens. "Now" is fixed when the screen opens, so the range (and
 * the query key built from it) stays stable between renders.
 */
export function usePeriod(timezone: string) {
  const [now] = useState(() => new Date());
  const today = format(new TZDate(now, timezone), "yyyy-MM-dd");
  const [period, setPeriod] = useState<HistoryPeriod>(HISTORY_DEFAULT_PERIOD);
  const [custom, setCustom] = useState(() => ({
    from: format(subDays(new TZDate(now, timezone), 30), "yyyy-MM-dd"),
    to: today,
  }));
  return {
    period,
    setPeriod,
    custom,
    setCustom,
    today,
    range: periodRange(period, now, timezone, custom),
  };
}
