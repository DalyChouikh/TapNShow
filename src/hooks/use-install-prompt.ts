"use client";

import { useContext } from "react";
import {
  type InstallPrompt,
  InstallPromptContext,
} from "@/components/providers/install-prompt-provider";

/** Install the app, the iPhone guide, or nothing when already installed (spec §10 PWA). */
export function useInstallPrompt(): InstallPrompt {
  return useContext(InstallPromptContext);
}
