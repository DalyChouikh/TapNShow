import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { sqlNullable } from "@/server/db/rpc-args";
import {
  importReasonSchema,
  type ImportResult,
  type ImportRowInput,
  type Roster,
} from "@/shared/api/roster";

type Client = SupabaseClient<Database>;

/** Error shape every mutation returns (PostgREST error subset). */
export type DbError = { code?: string; message: string };

const dbRosterSchema = z
  .object({
    contacts: z.array(
      z.object({
        id: z.uuid(),
        email: z.string(),
        full_name: z.string(),
        list_ids: z.array(z.uuid()),
        unsubscribed: z.boolean().default(false),
        reported: z.boolean().default(false),
      }),
    ),
    lists: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        contact_count: z.number().int(),
      }),
    ),
    limits: z.object({
      contacts_max: z.number().int(),
      lists_max: z.number().int(),
      import_rows_max: z.number().int(),
    }),
  })
  .transform((db): Roster => ({
    contacts: db.contacts.map((c) => ({
      id: c.id,
      email: c.email,
      fullName: c.full_name,
      listIds: c.list_ids,
      unsubscribed: c.unsubscribed,
      reported: c.reported,
    })),
    lists: db.lists.map((l) => ({
      id: l.id,
      name: l.name,
      contactCount: l.contact_count,
    })),
    limits: {
      contactsMax: db.limits.contacts_max,
      listsMax: db.limits.lists_max,
      importRowsMax: db.limits.import_rows_max,
    },
  }));

const dbImportResultSchema = z
  .object({
    summary: z.object({
      new: z.number().int(),
      updated: z.number().int(),
      unchanged: z.number().int(),
      invalid: z.number().int(),
      merged: z.number().int(),
    }),
    new_lists: z.array(z.string()),
    limit_exceeded: z.enum(["contacts", "lists"]).nullable(),
    rows: z.array(
      z.object({
        row: z.number().int(),
        email: z.string(),
        full_name: z.string().nullable(),
        outcome: z.enum(["new", "updated", "unchanged", "invalid"]),
        reason: importReasonSchema.nullable(),
        added_lists: z.array(z.string()),
        previous_name: z.string().nullable(),
        merged_rows: z.array(z.number().int()),
      }),
    ),
  })
  .transform((db): ImportResult => ({
    summary: db.summary,
    newLists: db.new_lists,
    limitExceeded: db.limit_exceeded,
    rows: db.rows.map((r) => ({
      row: r.row,
      email: r.email,
      fullName: r.full_name,
      outcome: r.outcome,
      reason: r.reason,
      addedLists: r.added_lists,
      previousName: r.previous_name,
      mergedRows: r.merged_rows,
    })),
  }));

/** The whole roster through `roster()` (one jsonb value, so the 1,000-row Data API cap never applies). */
export async function getRoster(
  client: Client,
  workspaceId: string,
): Promise<{ data: Roster; error: null } | { data: null; error: DbError }> {
  const { data, error } = await client.rpc("roster", {
    p_workspace: workspaceId,
  });
  return error
    ? { data: null, error }
    : { data: dbRosterSchema.parse(data), error: null };
}

/** `import_contacts` (dry run = preview; commit = apply). */
export async function importContacts(
  client: Client,
  input: {
    workspaceId: string;
    rows: ImportRowInput[];
    dryRun: boolean;
    alsoAddToListId?: string;
  },
): Promise<
  { data: ImportResult; error: null } | { data: null; error: DbError }
> {
  const { data, error } = await client.rpc("import_contacts", {
    p_workspace: input.workspaceId,
    p_rows: input.rows.map((row) => ({
      row: row.row,
      full_name: row.fullName,
      email: row.email,
      lists: row.lists,
    })),
    p_dry_run: input.dryRun,
    p_also_add_to_list: input.alsoAddToListId,
  });
  return error
    ? { data: null, error }
    : { data: dbImportResultSchema.parse(data), error: null };
}

/**
 * `update_contact`: name, email and lists in one transaction, scoped to `workspaceId`.
 * An omitted field is left unchanged; `tn:not_found` when the person or a list is elsewhere.
 */
export function updateContact(
  client: Client,
  input: {
    workspaceId: string;
    contactId: string;
    fullName?: string;
    email?: string;
    listIds?: string[];
  },
): PromiseLike<{ error: DbError | null }> {
  return client.rpc("update_contact", {
    p_workspace: input.workspaceId,
    p_contact: input.contactId,
    p_full_name: sqlNullable(input.fullName),
    p_email: sqlNullable(input.email),
    p_list_ids: sqlNullable(input.listIds),
  });
}

/** Deletes one person (memberships go with them). Empty `data` means not found. */
export function deleteContact(
  client: Client,
  workspaceId: string,
  contactId: string,
) {
  return client
    .from("contacts")
    .delete()
    .eq("id", contactId)
    .eq("workspace_id", workspaceId)
    .select("id");
}

const BULK_ACTIONS = {
  delete: "delete",
  addToList: "add_to_list",
  removeFromList: "remove_from_list",
} as const;

/** `bulk_contacts`: Select-mode actions; returns the number of affected rows. */
export function bulkContacts(
  client: Client,
  input: {
    workspaceId: string;
    action: keyof typeof BULK_ACTIONS;
    contactIds: string[];
    listId?: string;
  },
) {
  return client.rpc("bulk_contacts", {
    p_workspace: input.workspaceId,
    p_action: BULK_ACTIONS[input.action],
    p_contact_ids: input.contactIds,
    p_list_id: input.listId,
  });
}

/** Creates a list (case-insensitive unique name; cap trigger). */
export function createList(client: Client, workspaceId: string, name: string) {
  return client
    .from("lists")
    .insert({ workspace_id: workspaceId, name })
    .select("id, name")
    .single();
}

/** Renames a list. Empty `data` means not found. */
export function renameList(
  client: Client,
  workspaceId: string,
  listId: string,
  name: string,
) {
  return client
    .from("lists")
    .update({ name })
    .eq("id", listId)
    .eq("workspace_id", workspaceId)
    .select("id");
}

/** Deletes a list (people stay). Empty `data` means not found. */
export function deleteList(
  client: Client,
  workspaceId: string,
  listId: string,
) {
  return client
    .from("lists")
    .delete()
    .eq("id", listId)
    .eq("workspace_id", workspaceId)
    .select("id");
}
