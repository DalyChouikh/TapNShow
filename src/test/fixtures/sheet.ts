import type { SheetStatus } from "@/shared/api/sheets";

/** `GET …/sheet`: the workspace's Google Sheet in `state`, owned by Daly. */
export function sheetFixture(state: SheetStatus["state"] = "off"): SheetStatus {
  return {
    state,
    spreadsheetId: state === "off" ? null : "file-abcdefghij",
    pausedReason: null,
    syncedAt: null,
    behind: false,
    createdAt: null,
    turnedOnBy: "",
    accountEmail: null,
    ownerName: "Daly",
    tabs: [],
    sharing: null,
  };
}
