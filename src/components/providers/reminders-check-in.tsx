"use client";

import { useEffect } from "react";
import { checkInReminders } from "@/lib/push/client";

/**
 * Once per app load, a device with reminders on tells the server it is still alive (spec §8;
 * `checkInReminders` sends at most once a day). Mounted in the root layout so organizers who never
 * open `/invites` keep their reminders too. Renders nothing.
 */
export function RemindersCheckIn(): null {
  useEffect(() => {
    void checkInReminders(new Date());
  }, []);
  return null;
}
