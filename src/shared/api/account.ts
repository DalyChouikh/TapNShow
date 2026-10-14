import { z } from "zod";

/** The word Delete my account asks for (spec §7.4; owner, 2026-10-14). */
export const ACCOUNT_DELETE_WORD = "confirm";

/** `DELETE /api/me`. Twin: `private.delete_account`'s check. */
export const deleteAccountBodySchema = z.object({
  confirm: z.literal(ACCOUNT_DELETE_WORD),
});

/** `GET /api/me/account`: what `/account` and its delete dialog say. Twin: `private.my_account`. */
export const accountSummarySchema = z.object({
  owned: z.array(z.object({ name: z.string(), slug: z.string() })),
  workspaces: z.number().int(),
  answersWithText: z.number().int(),
});
/** What `/account` shows about the signed-in person. */
export type AccountSummary = z.infer<typeof accountSummarySchema>;
