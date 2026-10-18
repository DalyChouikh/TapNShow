"use client";

import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `intervalMs` while mounted, for screens whose choices depend on
 * the clock (e.g. which reminder times are still ahead).
 */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
