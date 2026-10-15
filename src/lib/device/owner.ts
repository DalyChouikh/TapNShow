import { z } from "zod";
import { DEVICE_KEYS } from "@/config/members";
import { clearDeviceData } from "./clear";
import { readDeviceValue, writeDeviceValue } from "./storage";

const owner = () => readDeviceValue(DEVICE_KEYS.owner, z.string());

/**
 * At sign-in (spec §11 Push privacy): when another person used this device, their saved invites,
 * preferences and reminders go before this person sees anything; then the device is marked as
 * this person's. The same person keeps theirs.
 */
export async function claimDevice(userId: string): Promise<void> {
  if (owner() !== userId) {
    await clearDeviceData();
    writeDeviceValue(DEVICE_KEYS.owner, userId);
  }
}

/**
 * When a person saves something on an unmarked device (turning reminders on in a session that
 * began before the mark existed), it becomes theirs, so their own next sign-in keeps it. A device
 * already marked is left alone: only `claimDevice` changes hands.
 */
export function markDeviceOwner(userId: string): void {
  if (owner() === null) {
    writeDeviceValue(DEVICE_KEYS.owner, userId);
  }
}
