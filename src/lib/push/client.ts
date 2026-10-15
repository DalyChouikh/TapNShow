import { z } from "zod";
import { DEVICE_KEYS, REMINDERS_CHECK_IN_HOURS } from "@/config/members";
import { publicEnv } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import { needsHomeScreenSteps } from "@/lib/device/kind";
import { readDeviceValue, writeDeviceValue } from "@/lib/device/storage";
import { okSchema } from "@/shared/api/common";
import { pushSubscriptionBodySchema } from "@/shared/api/push";
import { base64UrlToBytes } from "./base64url";

/** Where this device stands with reminders (spec §7.4). */
export type RemindersState =
  "unavailable" | "unsupported" | "needs_install" | "blocked" | "off" | "on";

const SUBSCRIPTIONS = "/api/me/push-subscriptions";
const HOUR_MS = 3_600_000;

/** Reminders exist on this deployment (the public key is set; previews without keys hide them). */
export function remindersAvailable(): boolean {
  return Boolean(publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** This device's reminders state. */
export async function remindersState(): Promise<RemindersState> {
  if (!remindersAvailable()) {
    return "unavailable";
  }
  if (needsHomeScreenSteps()) {
    return "needs_install";
  }
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return "unsupported";
  }
  if (Notification.permission === "denied") {
    return "blocked";
  }
  return Notification.permission === "granted" && (await currentSubscription())
    ? "on"
    : "off";
}

/** Tells the server about this device's subscription and remembers when (a check-in). */
async function saveSubscription(
  subscription: PushSubscription,
  now: Date,
  onUnauthenticated?: () => void,
): Promise<void> {
  await apiRequest(SUBSCRIPTIONS, {
    method: "POST",
    body: pushSubscriptionBodySchema.parse(subscription.toJSON()),
    schema: okSchema,
    onUnauthenticated,
  });
  writeDeviceValue(DEVICE_KEYS.remindersCheckedInAt, now.toISOString());
}

/**
 * Re-sends this device's subscription at most every `REMINDERS_CHECK_IN_HOURS` while reminders are
 * on (spec §8): the server forgets devices with no sign of life, and a browser may replace its
 * subscription without telling the page. Best effort: a failure is tried again at the next visit,
 * and a gone session never sends anyone to sign-in.
 */
export async function checkInReminders(now: Date): Promise<void> {
  const last = readDeviceValue(
    DEVICE_KEYS.remindersCheckedInAt,
    z.iso.datetime(),
  );
  if (
    last !== null &&
    now.getTime() - Date.parse(last) < REMINDERS_CHECK_IN_HOURS * HOUR_MS
  ) {
    return;
  }
  try {
    const subscription =
      (await remindersState()) === "on" ? await currentSubscription() : null;
    if (subscription) {
      await saveSubscription(subscription, now, () => undefined);
    }
  } catch {
    // Offline, rate limited or signed out: the next visit tries again.
  }
}

/** Asks the browser, subscribes this device and tells the server; undone if the server refuses. */
export async function turnOnReminders(
  now: Date = new Date(),
): Promise<RemindersState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return permission === "denied" ? "blocked" : "off";
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(
      publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "",
    ),
  });
  try {
    await saveSubscription(subscription, now);
  } catch (error) {
    await subscription.unsubscribe();
    throw error;
  }
  return "on";
}

/** Tells the server (best effort: the person may be signed out already), then unsubscribes. */
export async function turnOffReminders(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  const subscription = await currentSubscription();
  if (!subscription) {
    return;
  }
  try {
    await apiRequest(SUBSCRIPTIONS, {
      method: "DELETE",
      body: { endpoint: subscription.endpoint },
      schema: okSchema,
      // After an account deletion the session is gone: no "please sign in" detour.
      onUnauthenticated: () => undefined,
    });
  } catch {
    // The device is unsubscribed below either way; the server row ages out (housekeeping).
  }
  await subscription.unsubscribe();
}
