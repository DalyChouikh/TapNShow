/** HTTP methods a route file can export. */
export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Per-IP limits for routes used before sign-in (`private.check_ip_rate_limit`). */
export type IpLimitAction = "otp_send" | "otp_verify" | "google_signin";

/**
 * Where a route's rate limit lives (spec §10 Route registries, §11 Rate limiting). The outer guard
 * (the Vercel WAF rule on `/api/*`) covers every route on top of these.
 */
export type LimitRule =
  /** The named function's definition spends `action` (through `hit_user_rate_limit`). */
  | { kind: "user"; action: string; in: `${"public" | "private"}.${string}` }
  /** A statement trigger on `table` spends `action` for direct writes by signed-in users. */
  | { kind: "write"; action: string; table: `public.${string}` }
  | { kind: "ip"; action: IpLimitAction }
  /** The public token routes: per IP and per token (`loadTokenContext`). */
  | { kind: "token" }
  /** The internal worker route: the dispatch secret. */
  | { kind: "secret" }
  /** Nothing beyond the outer guard, and why that is enough. */
  | { kind: "outer"; reason: string };

/** How a GET route bounds what it returns (filled by Task 4). */
export type ListRule =
  | { kind: "paged"; size: string }
  | { kind: "bounded"; by: string }
  | { kind: "single" };

/** One method of one route. */
export type RouteEntry = { limits: readonly LimitRule[]; list?: ListRule };

const user = (
  action: string,
  fn: `${"public" | "private"}.${string}`,
): LimitRule => ({
  kind: "user",
  action,
  in: fn,
});
const write = (action: string, table: `public.${string}`): LimitRule => ({
  kind: "write",
  action,
  table,
});
const ip = (action: IpLimitAction): LimitRule => ({ kind: "ip", action });
const outer = (reason: string): LimitRule => ({ kind: "outer", reason });
const TOKEN: LimitRule = { kind: "token" };
const SECRET: LimitRule = { kind: "secret" };
const SIGNED_IN_READ = outer("signed-in read: the WAF guard");

/**
 * Every route file and exported method under `src/app/api/` (route-registry.test.ts fails for a
 * missing or stale one). Adding a route is a decision about its limit: write it here in the
 * same PR.
 */
export const ROUTES: Record<
  string,
  Partial<Record<RouteMethod, RouteEntry>>
> = {
  "[...path]": {
    GET: {
      limits: [outer("unknown address: answers 404 with no database call")],
    },
    POST: {
      limits: [outer("unknown address: answers 404 with no database call")],
    },
    PUT: {
      limits: [outer("unknown address: answers 404 with no database call")],
    },
    PATCH: {
      limits: [outer("unknown address: answers 404 with no database call")],
    },
    DELETE: {
      limits: [outer("unknown address: answers 404 with no database call")],
    },
  },
  "auth/google/callback": {
    GET: {
      limits: [
        outer(
          "refused at once without the state cookie that only the IP-limited start sets",
        ),
      ],
    },
  },
  "auth/google/start": {
    GET: { limits: [ip("google_signin")] },
  },
  "auth/otp/send": {
    POST: { limits: [ip("otp_send")] },
  },
  "auth/otp/verify": {
    POST: { limits: [ip("otp_verify")] },
  },
  "auth/signout": {
    POST: {
      limits: [outer("signing out must always work; no database write")],
    },
  },
  health: {
    GET: {
      limits: [
        outer("uptime probe, excluded from the WAF rule; one constant query"),
      ],
    },
  },
  "integrations/google/callback": {
    GET: {
      limits: [
        outer(
          "refused at once without the state cookie that only the rate-limited connect start sets",
        ),
      ],
    },
  },
  "integrations/google/connect": {
    GET: {
      limits: [user("google_connect", "public.hit_google_connect_limit")],
    },
  },
  "integrations/google/connections/[id]": {
    DELETE: {
      limits: [
        user("google_disconnect", "public.disconnect_google_connection"),
      ],
    },
  },
  "internal/dispatch": {
    POST: { limits: [SECRET] },
  },
  "invites/accept": {
    POST: { limits: [user("invite_accept", "public.accept_invite")] },
  },
  "invites/preview": {
    POST: { limits: [user("invite_preview", "public.invite_preview")] },
  },
  me: {
    GET: { limits: [SIGNED_IN_READ] },
    PATCH: { limits: [write("profile_write", "public.profiles")] },
    DELETE: { limits: [user("account_delete", "private.delete_account")] },
  },
  "me/account": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "me/answers": {
    GET: { limits: [user("answers_download", "private.my_answers")] },
  },
  "me/invites": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "me/invites/[id]/link": {
    GET: { limits: [user("invite_link", "private.my_invite")] },
  },
  "me/push-subscriptions": {
    POST: { limits: [user("push_subscribe", "private.push_subscribe")] },
    DELETE: { limits: [user("push_unsubscribe", "private.push_unsubscribe")] },
  },
  "r/[token]": {
    GET: { limits: [TOKEN] },
  },
  "r/[token]/calendar": {
    POST: { limits: [TOKEN] },
  },
  "r/[token]/ics": {
    GET: { limits: [TOKEN] },
  },
  "r/[token]/report": {
    POST: { limits: [TOKEN] },
  },
  "r/[token]/response": {
    PUT: { limits: [TOKEN] },
  },
  "r/[token]/resubscribe": {
    POST: { limits: [TOKEN] },
  },
  "r/[token]/unsubscribe": {
    GET: { limits: [outer("redirects to /u/<token>; no database call")] },
    POST: { limits: [TOKEN] },
  },
  workspaces: {
    POST: { limits: [user("workspace_create", "private.create_workspace")] },
  },
  "workspaces/[slug]": {
    GET: { limits: [SIGNED_IN_READ] },
    PATCH: { limits: [write("workspace_write", "public.workspaces")] },
    DELETE: { limits: [user("workspace_delete", "public.delete_workspace")] },
  },
  "workspaces/[slug]/attendance": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "workspaces/[slug]/attendance/details": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "workspaces/[slug]/contacts": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "workspaces/[slug]/contacts/[id]": {
    PATCH: { limits: [write("contact_write", "public.contacts")] },
    DELETE: { limits: [write("contact_write", "public.contacts")] },
  },
  "workspaces/[slug]/contacts/[id]/history": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "workspaces/[slug]/contacts/bulk": {
    POST: {
      limits: [
        write("contact_write", "public.contacts"),
        write("contact_write", "public.list_contacts"),
      ],
    },
  },
  "workspaces/[slug]/contacts/import": {
    POST: {
      limits: [
        user("import", "public.import_contacts"),
        user("import_preview", "public.import_contacts"),
      ],
    },
  },
  "workspaces/[slug]/invites": {
    GET: { limits: [SIGNED_IN_READ] },
    POST: { limits: [user("invite_create", "public.create_invite")] },
  },
  "workspaces/[slug]/invites/[id]": {
    DELETE: { limits: [user("invite_revoke", "public.revoke_invite")] },
  },
  "workspaces/[slug]/invites/[id]/renew": {
    POST: { limits: [user("invite_renew", "public.renew_invite")] },
  },
  "workspaces/[slug]/lists": {
    POST: { limits: [write("list_write", "public.lists")] },
  },
  "workspaces/[slug]/lists/[id]": {
    PATCH: { limits: [write("list_write", "public.lists")] },
    DELETE: { limits: [write("list_write", "public.lists")] },
  },
  "workspaces/[slug]/meeting-defaults": {
    GET: { limits: [SIGNED_IN_READ] },
    PATCH: { limits: [write("workspace_write", "public.workspaces")] },
  },
  "workspaces/[slug]/meetings": {
    GET: { limits: [SIGNED_IN_READ] },
    POST: { limits: [user("meeting_create", "private.create_meeting")] },
  },
  "workspaces/[slug]/meetings/[id]": {
    GET: { limits: [SIGNED_IN_READ] },
    PATCH: { limits: [write("meeting_write", "public.meetings")] },
    DELETE: {
      limits: [
        write("meeting_write", "public.meetings"),
        user("meeting_delete", "public.delete_cancelled_meeting"),
      ],
    },
  },
  "workspaces/[slug]/meetings/[id]/audience": {
    GET: { limits: [SIGNED_IN_READ] },
    PUT: { limits: [user("audience_set", "public.set_meeting_audience")] },
  },
  "workspaces/[slug]/meetings/[id]/cancel": {
    POST: { limits: [user("meeting_cancel", "public.cancel_meeting")] },
  },
  "workspaces/[slug]/meetings/[id]/changes": {
    POST: { limits: [user("meeting_edit_email", "private.edit_sent_meeting")] },
  },
  "workspaces/[slug]/meetings/[id]/check-in": {
    PUT: { limits: [user("check_in_mark", "private.mark_attendance")] },
  },
  "workspaces/[slug]/meetings/[id]/check-in/rest": {
    POST: { limits: [user("check_in_rest", "private.mark_rest_as_declared")] },
  },
  "workspaces/[slug]/meetings/[id]/duplicate": {
    POST: { limits: [user("meeting_create", "private.duplicate_meeting")] },
  },
  "workspaces/[slug]/meetings/[id]/nudge": {
    POST: { limits: [user("meeting_nudge", "public.nudge_meeting")] },
  },
  "workspaces/[slug]/meetings/[id]/people": {
    GET: { limits: [SIGNED_IN_READ] },
    POST: {
      limits: [user("meeting_people_add", "private.add_meeting_people")],
    },
  },
  "workspaces/[slug]/meetings/[id]/preview": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "workspaces/[slug]/meetings/[id]/results": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "workspaces/[slug]/meetings/[id]/send": {
    POST: { limits: [user("meeting_send", "public.send_meeting")] },
  },
  "workspaces/[slug]/members": {
    GET: { limits: [SIGNED_IN_READ] },
  },
  "workspaces/[slug]/members/[userId]": {
    PATCH: { limits: [user("member_change", "public.change_role")] },
    DELETE: {
      limits: [
        user("member_change", "public.remove_member"),
        user("member_change", "public.leave_workspace"),
      ],
    },
  },
  "workspaces/[slug]/sender": {
    GET: { limits: [SIGNED_IN_READ] },
    PUT: { limits: [user("sender_set", "public.set_workspace_sender")] },
  },
  "workspaces/[slug]/sheet": {
    GET: { limits: [SIGNED_IN_READ] },
    DELETE: { limits: [user("sheet_off", "public.turn_off_sheet")] },
  },
  "workspaces/[slug]/sheet/retry": {
    POST: { limits: [user("sheet_retry", "private.retry_sheet")] },
  },
  "workspaces/[slug]/transfer": {
    POST: { limits: [user("ownership_transfer", "public.transfer_ownership")] },
  },
};
