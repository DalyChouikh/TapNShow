"use client";

import { useContext } from "react";
import {
  type InstallPrompt,
  InstallPromptContext,
} from "@/components/providers/install-prompt-provider";

/** The browser's install offer, if it made one (spec §10 PWA): Install the app. */
export function useInstallPrompt(): InstallPrompt {
  return useContext(InstallPromptContext);
}
