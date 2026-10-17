"use client";

import { addHours } from "date-fns";
import { useState } from "react";
import { z } from "zod";
import type { DeviceKey } from "@/config/members";
import { useIsClient } from "@/lib/use-is-client";
import { readDeviceValue, writeDeviceValue } from "./storage";

/**
 * "Not now" for a card on this device: hidden until the instant stored under `key`, and `hide()`
 * stores `now` plus `days` (whole 24-hour days). Hidden while the server renders and hydrates, so
 * a dismissed card never flashes in.
 */
export function useHiddenUntil(
  key: DeviceKey,
  days: number,
  now: Date,
): { hidden: boolean; hide: () => void } {
  const isClient = useIsClient();
  const [dismissed, setDismissed] = useState(false);
  const until = isClient ? readDeviceValue(key, z.iso.datetime()) : null;
  return {
    hidden:
      !isClient ||
      dismissed ||
      (until !== null && Date.parse(until) > now.getTime()),
    hide: () => {
      writeDeviceValue(key, addHours(now, days * 24).toISOString());
      setDismissed(true);
    },
  };
}
