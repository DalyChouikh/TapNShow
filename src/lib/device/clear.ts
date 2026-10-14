import { clearDeviceValues } from "./storage";

/** Prefix of every Cache Storage name TapNShow's service worker uses (`src/app/sw.ts`). */
export const CACHE_PREFIX = "tn-";

/**
 * Removes what TapNShow saved on this device (spec §11 Push privacy): saved pages and invites,
 * and preferences. Called before signing out and after deleting the account, so a shared phone
 * never shows the previous person's invites. Never throws.
 */
export async function clearDeviceData(): Promise<void> {
  clearDeviceValues();
  try {
    if (typeof window !== "undefined" && "caches" in window) {
      const names = await window.caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX))
          .map((name) => window.caches.delete(name)),
      );
    }
  } catch {
    // Storage the browser refuses to open has nothing of ours in it.
  }
}
