import { errorCodeOf } from "@/lib/api-client";
import type { ApiErrorCode } from "@/shared/api/errors";
import type { Roster } from "@/shared/api/roster";

/**
 * What went wrong with a person edit. For `contact_email_taken`, `takenBy` is the name of the
 * roster person who already uses that email, so the UI can say "Already in your roster: Sarra".
 */
export function describeEditError(
  error: Error,
  email: string | undefined,
  roster: Roster,
): { code: ApiErrorCode; takenBy: string | null } {
  const code = errorCodeOf(error);
  const takenBy =
    code === "contact_email_taken"
      ? (roster.contacts.find((contact) => contact.email === email)?.fullName ??
        null)
      : null;
  return { code, takenBy };
}
