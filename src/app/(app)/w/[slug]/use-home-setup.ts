"use client";

import { useWorkspaceInsights } from "@/hooks/use-results";
import { useWorkspaceSender } from "@/hooks/use-sender";
import { useWorkspaceSheet } from "@/hooks/use-sheet";
import type { PeriodRange } from "@/shared/api/responses";

/** Home's setup steps in order (design §2.6); the required ones decide when the card goes away. */
export const SETUP_STEPS = [
  { key: "importMembers", required: true, ownerOnly: false },
  { key: "connectGmail", required: true, ownerOnly: true },
  { key: "inviteCommittee", required: false, ownerOnly: false },
  { key: "connectSheets", required: false, ownerOnly: true },
] as const;

/** A setup step. */
export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"];

/** Where the workspace's setup stands, once its roster, sender and sheet have loaded. */
export type HomeSetup =
  | { state: "loading" }
  | { state: "error"; retry: () => void }
  | {
      state: "ready";
      done: Record<SetupStepKey, boolean>;
      /** Every required step is done: the card is gone. */
      complete: boolean;
      /** Who connects Gmail and Google Sheets (the Owner). */
      ownerName: string;
    };

/**
 * Home's setup state from the roster counts (the insights for `range`, the request Home makes
 * anyway), the sender and the sheet.
 */
export function useHomeSetup(slug: string, range: PeriodRange): HomeSetup {
  const insights = useWorkspaceInsights(slug, range);
  const sender = useWorkspaceSender(slug);
  const sheet = useWorkspaceSheet(slug);
  if (!insights.data || !sender.data || !sheet.data) {
    const failed = [insights, sender, sheet].filter((query) => query.isError);
    return failed.length > 0
      ? {
          state: "error",
          retry: () => {
            for (const query of failed) {
              void query.refetch();
            }
          },
        }
      : { state: "loading" };
  }
  const { roster, held } = insights.data;
  const done: Record<SetupStepKey, boolean> = {
    importMembers: roster.members > 0,
    // Connected, even if it needs reconnecting: Needs attention asks for that.
    connectGmail: sender.data.sender !== null,
    inviteCommittee: roster.committee > 0,
    connectSheets: sheet.data.state !== "off",
  };
  return {
    state: "ready",
    done,
    // A workspace that has held a meeting is set up for good: a Gmail disconnected later is
    // Needs attention's and the next-meeting card's to mention, not a new-workspace welcome.
    complete:
      held > 0 || SETUP_STEPS.every((step) => !step.required || done[step.key]),
    ownerName: sender.data.ownerName,
  };
}
