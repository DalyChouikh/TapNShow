import type { Member } from "@/shared/api/members";
import type { WorkspaceRole } from "@/shared/api/me";

/** Row action in Settings > People. */
export type MemberAction =
  "makeAdmin" | "makeViewer" | "toggleCheckIn" | "remove";

/**
 * Actions the UI offers (mirrors the database rules, spec §3; the database still decides).
 * Yourself and the Owner have no row actions: use Leave / Transfer in the Danger zone.
 */
export function memberActions(
  myRole: WorkspaceRole,
  myId: string,
  member: Member,
): MemberAction[] {
  if (
    myRole === "viewer" ||
    member.role === "owner" ||
    member.userId === myId
  ) {
    return [];
  }
  if (member.role === "admin") {
    return myRole === "owner" ? ["makeViewer", "remove"] : [];
  }
  return myRole === "owner"
    ? ["makeAdmin", "toggleCheckIn", "remove"]
    : ["toggleCheckIn", "remove"];
}
