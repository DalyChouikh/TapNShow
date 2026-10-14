import { z } from "zod";

/** The word Delete my account asks for (spec §7.4; owner, 2026-10-14). */
export const ACCOUNT_DELETE_WORD = "confirm";

/** `DELETE /api/me`. Twin: `private.delete_account`'s check. */
export const deleteAccountBodySchema = z.object({
  confirm: z.literal(ACCOUNT_DELETE_WORD),
});
