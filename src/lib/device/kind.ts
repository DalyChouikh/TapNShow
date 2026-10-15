"use client";

import { useSyncExternalStore } from "react";

/** What a device is, for the words that name it ("this phone", "this computer"…). */
export type DeviceKind =
  "phone" | "iphone" | "ipad" | "tablet" | "computer" | "device";

const noopSubscribe = () => () => undefined;

/**
 * What kind of device this browser runs on, from its user agent. iPadOS Safari asks for desktop
 * sites and calls itself "Macintosh", so touch is what tells an iPad from a Mac. Anything unclear
 * is a plain "device".
 */
export function deviceKind(): DeviceKind {
  const agent = navigator.userAgent;
  if (/iPhone|iPod/.test(agent)) {
    return "iphone";
  }
  if (
    /iPad/.test(agent) ||
    (agent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  ) {
    return "ipad";
  }
  if (/Android/.test(agent)) {
    return /Mobile/.test(agent) ? "phone" : "tablet";
  }
  if (/Mobi/.test(agent)) {
    return "phone";
  }
  return /Windows|Macintosh|X11|CrOS|Linux/.test(agent) ? "computer" : "device";
}

/** Opened from the Home Screen / as an installed app. */
export function isStandalone(): boolean {
  const legacy = navigator.standalone === true;
  return window.matchMedia("(display-mode: standalone)").matches || legacy;
}

/**
 * An iPhone or iPad in the browser: notifications need TapNShow on the Home Screen first
 * (iOS/iPadOS 16.4+). The one place this rule lives (reminders state, the iPhone guide).
 */
export function needsHomeScreenSteps(): boolean {
  const kind = deviceKind();
  return (kind === "iphone" || kind === "ipad") && !isStandalone();
}

/** `deviceKind()` for components ("device" while pre-rendering). */
export function useDeviceKind(): DeviceKind {
  return useSyncExternalStore(noopSubscribe, deviceKind, () => "device");
}
