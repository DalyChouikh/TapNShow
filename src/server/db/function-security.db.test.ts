import { describe, expect, it } from "vitest";
import { z } from "zod";
import { queryLocalSql } from "@/test/db/sql";

const names = z.array(z.object({ name: z.string() }));

/**
 * The private functions signed-in users may reach (through RLS policies or public wrappers).
 * Adding one is a security decision: extend this list in the same PR, sorted.
 */
const PRIVATE_FUNCTIONS_FOR_AUTHENTICATED = [
  "accept_invite",
  "add_meeting_people",
  "app_limit",
  "audience_members",
  "change_role",
  "consume_invite_email",
  "create_invite",
  "create_meeting",
  "create_workspace",
  "delete_workspace",
  "disconnect_google_connection",
  "hit_user_rate_limit",
  "invite_preview",
  "is_member",
  "is_valid_email",
  "leave_workspace",
  "list_members",
  "meeting_progress",
  "remove_member",
  "renew_invite",
  "revoke_invite",
  "role_of",
  "send_meeting",
  "set_meeting_audience",
  "set_workspace_sender",
  "transfer_ownership",
  "valid_delay_options",
  "workspace_sender",
];

describe("function security (spec §11)", () => {
  it("keeps every SECURITY DEFINER function out of the exposed public schema", () => {
    const rows = queryLocalSql(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef order by 1`,
      names,
    );
    expect(rows).toEqual([]);
  });

  it("lets authenticated execute only the allow-listed private functions", () => {
    const rows = queryLocalSql(
      `select distinct p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'EXECUTE') order by 1`,
      names,
    );
    expect(rows.map((row) => row.name)).toEqual(
      PRIVATE_FUNCTIONS_FOR_AUTHENTICATED,
    );
  });

  it("exposes the M2 RPCs as invoker wrappers with unchanged names", () => {
    const rows = queryLocalSql(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and not p.prosecdef and p.proname = any (array[
         'create_workspace','list_members','check_ip_rate_limit','change_role','remove_member',
         'leave_workspace','transfer_ownership','delete_workspace','create_invite','renew_invite',
         'revoke_invite','consume_invite_email','invite_preview','accept_invite'])
       order by 1`,
      names,
    );
    expect(rows).toHaveLength(14);
  });
});
