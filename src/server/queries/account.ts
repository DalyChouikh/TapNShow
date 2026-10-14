import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import {
  type ReleasedConnection,
  releasedSchema,
} from "@/server/google/release";
import type { DbError } from "./roster";
import type { AccountSummary } from "@/shared/api/account";

type Client = SupabaseClient<Database>;

/** An Owner to email after an account deletion paused something of their workspace. */
export type OwnerAlert = {
  kind: "sender" | "sheet";
  email: string;
  workspaceName: string;
  workspaceSlug: string;
};

/** What the database part of an account deletion hands to the route. */
export type AccountDeletion = {
  released: ReleasedConnection[];
  alerts: OwnerAlert[];
};

const dbSchema = z.object({
  released: z.array(releasedSchema),
  alerts: z.array(
    z.object({
      kind: z.enum(["sender", "sheet"]),
      email: z.string(),
      workspace_name: z.string(),
      workspace_slug: z.string(),
    }),
  ),
});

/** `delete_account()`: refuses, or erases and releases (spec §11). */
export async function deleteAccountData(
  client: Client,
  confirm: string,
): Promise<{ data: AccountDeletion | null; error: DbError | null }> {
  const { data, error } = await client.rpc("delete_account", {
    p_confirm: confirm,
  });
  if (error) {
    return { data: null, error };
  }
  const db = dbSchema.parse(data);
  return {
    data: {
      released: db.released.filter(
        (row): row is ReleasedConnection => row !== null,
      ),
      alerts: db.alerts.map((alert) => ({
        kind: alert.kind,
        email: alert.email,
        workspaceName: alert.workspace_name,
        workspaceSlug: alert.workspace_slug,
      })),
    },
    error: null,
  };
}

const dbSummarySchema = z.object({
  owned: z.array(z.object({ name: z.string(), slug: z.string() })),
  workspaces: z.number().int(),
  answers_with_text: z.number().int(),
});

/** `my_account()`: owned workspaces, how many workspaces, how many answers have words. */
export async function getMyAccount(
  client: Client,
): Promise<{ data: AccountSummary | null; error: DbError | null }> {
  const { data, error } = await client.rpc("my_account");
  if (error) {
    return { data: null, error };
  }
  const db = dbSummarySchema.parse(data);
  return {
    data: {
      owned: db.owned,
      workspaces: db.workspaces,
      answersWithText: db.answers_with_text,
    },
    error: null,
  };
}
