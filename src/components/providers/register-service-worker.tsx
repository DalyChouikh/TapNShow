"use client";

import { useSerwist } from "@serwist/turbopack/react";
import { useEffect } from "react";

/**
 * Registers the service worker (spec §10 PWA) once the provider has made it. Some browsers refuse
 * one (private windows, a deployment address behind Vercel's sign-in redirect): the app works
 * without it, minus offline reading and reminders, so a refusal is expected, not an error to report.
 */
export function RegisterServiceWorker(): null {
  const { serwist } = useSerwist();
  useEffect(() => {
    serwist?.register().catch(() => undefined);
  }, [serwist]);
  return null;
}
