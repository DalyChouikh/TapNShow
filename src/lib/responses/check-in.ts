import type { AnswerStatus, Mark } from "@/shared/api/responses";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

/** Who may check people in (spec §7.8). DB twin: `private.can_check_in`. */
export function canCheckIn(workspace: WorkspaceDetails): boolean {
  return workspace.myRole !== "viewer" || workspace.canCheckIn;
}

const DECLARED: Record<AnswerStatus, Mark["actual"]> = {
  attending: "present",
  late: "late",
  absent: "absent",
  not_attending: "absent",
};

/**
 * The check-in an answer suggests (the dashed hint). No reply suggests nothing here; "Mark the
 * rest as they said" marks it Absent (DB twin: `private.mark_rest_as_declared`).
 */
export function declaredActual(
  answer: AnswerStatus | null,
): Mark["actual"] | null {
  return answer ? DECLARED[answer] : null;
}
