import type { z } from "zod";
import type { DeviceKey } from "@/config/members";

const PREFIX = "tn.";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Some private modes throw on access: behave as an empty store.
    return null;
  }
}

/** A value TapNShow saved on this device, or null when missing or not what `schema` expects. */
export function readDeviceValue<T>(
  key: DeviceKey,
  schema: z.ZodType<T>,
): T | null {
  const raw = storage()?.getItem(key) ?? null;
  const parsed = raw === null ? null : schema.safeParse(raw);
  return parsed?.success ? parsed.data : null;
}

/** Saves a value on this device (silently skipped when storage is unavailable or full). */
export function writeDeviceValue(key: DeviceKey, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Quota or private mode: the preference just isn't remembered.
  }
}

/** Removes every value TapNShow saved on this device (sign-out, account deletion). */
export function clearDeviceValues(): void {
  const store = storage();
  if (!store) {
    return;
  }
  const keys = Array.from({ length: store.length }, (_, index) =>
    store.key(index),
  ).filter((key): key is string => key?.startsWith(PREFIX) ?? false);
  for (const key of keys) {
    store.removeItem(key);
  }
}
