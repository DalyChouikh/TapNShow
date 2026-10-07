import { z } from "zod";

/** Every error code an API route may return. The client translates them (`ApiErrors`). */
export const API_ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "not_found",
  "invalid_input",
  "invalid_origin",
  "conflict",
  "rate_limited",
  "internal",
  "invalid_timezone",
  "workspace_limit",
  "use_transfer",
  "use_leave",
  "owner_cannot_leave",
  "name_mismatch",
  "target_not_admin",
  "already_member",
  "invite_closed",
  "invite_revoked",
  "invite_already_member",
  "invite_used",
  "invite_expired",
  "invite_wrong_account",
  "invite_email_limit",
  "email_failed",
  "invalid_code",
  "send_failed",
  "google_unavailable",
  "contact_email_taken",
  "contacts_limit_reached",
  "lists_limit_reached",
  "list_name_taken",
  "import_too_many_rows",
  "owner_only",
] as const;

/** An API error code. */
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** HTTP status for each error code. */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
  invalid_origin: 403,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
  invalid_timezone: 400,
  workspace_limit: 409,
  use_transfer: 409,
  use_leave: 409,
  owner_cannot_leave: 409,
  name_mismatch: 400,
  target_not_admin: 409,
  already_member: 409,
  invite_closed: 409,
  invite_revoked: 410,
  invite_already_member: 409,
  invite_used: 410,
  invite_expired: 410,
  invite_wrong_account: 403,
  invite_email_limit: 429,
  email_failed: 502,
  invalid_code: 400,
  send_failed: 502,
  google_unavailable: 404,
  contact_email_taken: 409,
  contacts_limit_reached: 409,
  lists_limit_reached: 409,
  list_name_taken: 409,
  import_too_many_rows: 400,
  owner_only: 403,
};

/** Body of every non-2xx API response. */
export const apiErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    details: z.record(z.string(), z.string()).optional(),
  }),
});
