"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

/** Chrome's `beforeinstallprompt` (not in lib.dom). */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** What the app knows about installing itself on this device (spec §10 PWA). */
export type InstallPrompt = {
  /** The browser offers to install now (Android, desktop Chrome and Edge). */
  canInstall: boolean;
  /** Shows the browser's install dialog; the offer is used up either way. */
  install: () => Promise<void>;
};

/** The install offer, captured once at the root: the browser fires it once, at load. */
export const InstallPromptContext = createContext<InstallPrompt>({
  canInstall: false,
  install: async () => undefined,
});

/** Keeps the browser's one-time install offer for any page to use (Install the app). */
export function InstallPromptProvider({ children }: { children: ReactNode }) {
  const [offer, setOffer] = useState<InstallPromptEvent | null>(null);
  useEffect(() => {
    const keep = (event: Event) => {
      // The app shows its own Install button instead of the browser's mini bar.
      event.preventDefault();
      setOffer(event as InstallPromptEvent);
    };
    const installed = () => setOffer(null);
    window.addEventListener("beforeinstallprompt", keep);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", keep);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  const install = useCallback(async () => {
    if (!offer) {
      return;
    }
    setOffer(null);
    await offer.prompt();
  }, [offer]);
  const value = useMemo<InstallPrompt>(
    () => ({ canInstall: offer !== null, install }),
    [offer, install],
  );
  return (
    <InstallPromptContext.Provider value={value}>
      {children}
    </InstallPromptContext.Provider>
  );
}
