import { z } from "zod";
import {
  IMPORT_CELL_MAX_CHARS,
  IMPORT_LISTS_PER_ROW_MAX,
} from "@/config/roster";
import { emailSchema } from "./common";

/** A person's full name (matches the database check: trimmed, 1–120 characters). */
export const contactNameSchema = z
  .string()
  .transform((name) => name.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1).max(120));

/** A list name (matches the database check: trimmed, 1–60 characters). */
export const listNameSchema = z.string().trim().min(1).max(60);

/** One person of the roster. */
export const contactSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  listIds: z.array(z.uuid()),
});
/** One person of the roster. */
export type Contact = z.infer<typeof contactSchema>;

/** A list with how many roster people are in it. */
export const listSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  contactCount: z.number().int().nonnegative(),
});
/** A list with its member count. */
export type ListSummary = z.infer<typeof listSummarySchema>;

/** Caps the UI needs (values come from the database's app_limits). */
export const rosterLimitsSchema = z.object({
  contactsMax: z.number().int().positive(),
  listsMax: z.number().int().positive(),
  importRowsMax: z.number().int().positive(),
});

/** `GET /api/workspaces/[slug]/contacts` response: the whole roster. */
export const rosterSchema = z.object({
  contacts: z.array(contactSchema),
  lists: z.array(listSummarySchema),
  limits: rosterLimitsSchema,
});
/** The whole roster of a workspace. */
export type Roster = z.infer<typeof rosterSchema>;

const importCell = z.string().max(IMPORT_CELL_MAX_CHARS);

/** One row sent to the import route: raw cell text; the database validates and reports. */
export const importRowInputSchema = z.object({
  row: z.number().int().positive(),
  fullName: importCell.nullable(),
  email: importCell.nullable(),
  lists: z.array(importCell).max(IMPORT_LISTS_PER_ROW_MAX),
});
/** One row sent to the import route. */
export type ImportRowInput = z.infer<typeof importRowInputSchema>;

/** `POST …/contacts/import` body. The row count is checked by the database (`import_rows_max`). */
export const importBodySchema = z.object({
  rows: z.array(importRowInputSchema),
  dryRun: z.boolean(),
  alsoAddToListId: z.uuid().optional(),
});
/** `POST …/contacts/import` body. */
export type ImportBody = z.infer<typeof importBodySchema>;

/** Why a row is skipped. */
export const IMPORT_REASONS = [
  "email_missing",
  "email_invalid",
  "name_missing",
  "name_too_long",
  "list_name_too_long",
] as const;
/** Why a row is skipped. */
export const importReasonSchema = z.enum(IMPORT_REASONS);
/** Why a row is skipped. */
export type ImportReason = z.infer<typeof importReasonSchema>;

/** What the import does with a row. */
export const importOutcomeSchema = z.enum([
  "new",
  "updated",
  "unchanged",
  "invalid",
]);
/** What the import does with a row. */
export type ImportOutcome = z.infer<typeof importOutcomeSchema>;

/** One row of the preview (a merged person appears once, at its first row). */
export const importRowResultSchema = z.object({
  row: z.number().int(),
  email: z.string(),
  fullName: z.string().nullable(),
  outcome: importOutcomeSchema,
  reason: importReasonSchema.nullable(),
  addedLists: z.array(z.string()),
  previousName: z.string().nullable(),
  mergedRows: z.array(z.number().int()),
});
/** One row of the preview. */
export type ImportRowResult = z.infer<typeof importRowResultSchema>;

/** `POST …/contacts/import` response (dry run = preview; commit = what was applied). */
export const importResultSchema = z.object({
  summary: z.object({
    new: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int(),
    invalid: z.number().int(),
    merged: z.number().int(),
  }),
  newLists: z.array(z.string()),
  limitExceeded: z.enum(["contacts", "lists"]).nullable(),
  rows: z.array(importRowResultSchema),
});
/** Import preview or result. */
export type ImportResult = z.infer<typeof importResultSchema>;

/** `PATCH …/contacts/[id]` body: one or more fields; `listIds` replaces the person's lists. */
export const updateContactBodySchema = z
  .object({
    fullName: contactNameSchema.optional(),
    email: emailSchema.optional(),
    listIds: z.array(z.uuid()).optional(),
  })
  .refine(
    (body) =>
      body.fullName !== undefined ||
      body.email !== undefined ||
      body.listIds !== undefined,
  );
/** `PATCH …/contacts/[id]` body. */
export type UpdateContactBody = z.infer<typeof updateContactBodySchema>;

const contactIds = z.array(z.uuid()).min(1);

/** `POST …/contacts/bulk` body (Select mode). */
export const bulkContactsBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete"), contactIds }),
  z.object({ action: z.literal("addToList"), contactIds, listId: z.uuid() }),
  z.object({
    action: z.literal("removeFromList"),
    contactIds,
    listId: z.uuid(),
  }),
]);
/** `POST …/contacts/bulk` body. */
export type BulkContactsBody = z.infer<typeof bulkContactsBodySchema>;

/** `POST …/contacts/bulk` response. */
export const bulkResultSchema = z.object({ affected: z.number().int() });

/** `POST …/lists` and `PATCH …/lists/[id]` body. */
export const listBodySchema = z.object({ name: listNameSchema });

/** `POST …/lists` response. */
export const listCreatedSchema = z.object({ id: z.uuid(), name: z.string() });
/** A list just created. */
export type ListCreated = z.infer<typeof listCreatedSchema>;
