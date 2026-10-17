import { describe, expect, it } from "vitest";
import { z } from "zod";
import { queryLocalSql } from "@/test/db/sql";

const names = z.array(z.object({ name: z.string() }));

/**
 * The private functions signed-in users may reach (through RLS policies or public wrappers).
 * Adding one is a security decision: extend this list in the same PR, sorted.
 */
const PRIVATE_FUNCTIONS_FOR_AUTHENTICATED = [
  "accept_admin_invite",
  "accept_invite",
  "add_meeting_people",
  "admin_admins",
  "admin_invite",
  "admin_invite_preview",
  "admin_invite_renew",
  "admin_invite_revoke",
  "admin_lift",
  "admin_log",
  "admin_mark_reviewed",
  "admin_overview",
  "admin_remove",
  "admin_reports",
  "admin_suspend",
  "admin_workspace",
  "admin_workspaces",
  "app_limit",
  "assert_edit_can_send",
  "assert_meeting_can_send",
  "attendance_details",
  "attendance_summary",
  "audience_members",
  "cancel_meeting",
  "change_role",
  "consume_admin_invite_email",
  "consume_invite_email",
  "contact_history",
  "create_invite",
  "create_meeting",
  "create_workspace",
  "delete_account",
  "delete_cancelled_meeting",
  "delete_workspace",
  "disconnect_google_connection",
  "duplicate_meeting",
  "edit_sent_meeting",
  "hit_user_rate_limit",
  "invite_preview",
  "is_member",
  "is_valid_email",
  "leave_workspace",
  "list_members",
  "mark_attendance",
  "mark_rest_as_declared",
  "meeting_audience",
  "meeting_people",
  "meeting_results",
  "meetings_page",
  "members_page",
  "my_account",
  "my_answers",
  "my_invite",
  "my_invites",
  "my_platform_role",
  "nudge_meeting",
  "push_subscribe",
  "push_unsubscribe",
  "refuse_platform_owner_deletion",
  "remove_member",
  "renew_invite",
  "require_user_limit",
  "retry_sheet",
  "revoke_invite",
  "role_of",
  "send_meeting",
  "set_meeting_audience",
  "set_workspace_sender",
  "transfer_ownership",
  "turn_off_sheet",
  "valid_delay_options",
  "workspace_insights",
  "workspace_sender",
  "workspace_sheet",
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

  it("service_role cannot nudge (a nudge is a signed-in Owner's or Admin's action, #255)", () => {
    const [row] = queryLocalSql(
      `select has_function_privilege('service_role', 'public.nudge_meeting(uuid)', 'execute') as allowed`,
      z.array(z.object({ allowed: z.boolean() })).length(1),
    );
    expect(row.allowed).toBe(false);
  });

  it("lets anon execute exactly one public function: keep_alive", () => {
    const rows = queryLocalSql(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1`,
      names,
    );
    expect(rows.map((row) => row.name)).toEqual(["keep_alive"]);
  });
});
