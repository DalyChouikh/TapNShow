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

/** An iPhone or iPad: notifications need TapNShow on the Home Screen (iOS/iPadOS 16.4+). */
export function needsHomeScreen(kind: DeviceKind): boolean {
  return kind === "iphone" || kind === "ipad";
}

/** `deviceKind()` for components ("device" while pre-rendering). */
export function useDeviceKind(): DeviceKind {
  return useSyncExternalStore(noopSubscribe, deviceKind, () => "device");
}
