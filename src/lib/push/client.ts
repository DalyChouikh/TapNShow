import { publicEnv } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import { pushSubscriptionBodySchema } from "@/shared/api/push";
import { base64UrlToBytes } from "./base64url";

/** Where this device stands with reminders (spec §7.4). */
export type RemindersState =
  "unavailable" | "unsupported" | "needs_install" | "blocked" | "off" | "on";

const SUBSCRIPTIONS = "/api/me/push-subscriptions";

/** Reminders exist on this deployment (the public key is set; previews without keys hide them). */
export function remindersAvailable(): boolean {
  return Boolean(publicEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

/** An iPhone or iPad (iPadOS reports a Mac with touch). */
export function isIphone(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  );
}

/** Opened from the Home Screen / as an installed app. */
export function isStandalone(): boolean {
  const legacy = navigator.standalone === true;
  return window.matchMedia("(display-mode: standalone)").matches || legacy;
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
  if (isIphone() && !isStandalone()) {
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

/** Asks the browser, subscribes this device and tells the server; undone if the server refuses. */
export async function turnOnReminders(): Promise<RemindersState> {
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
    await apiRequest(SUBSCRIPTIONS, {
      method: "POST",
      body: pushSubscriptionBodySchema.parse(subscription.toJSON()),
      schema: okSchema,
    });
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
