import type { TestUser } from "./clients";
import { runLocalSql } from "./sql";

/** Makes `user` the platform owner or an admin directly (test setup; the product uses the script and invites). */
export function makePlatformAdmin(
  user: TestUser,
  role: "owner" | "admin" = "admin",
): void {
  runLocalSql(
    `insert into public.platform_admins (user_id, role) values ('${user.id}', '${role}')
     on conflict (user_id) do update set role = excluded.role`,
  );
}

/** Removes every platform admin (each test file starts from none). */
export function clearPlatformAdmins(): void {
  // One statement per call: `supabase db query` runs a single statement.
  runLocalSql("delete from public.platform_admins");
  runLocalSql("delete from public.platform_admin_invites");
}

/** Marks every waiting platform event as handled (tests of the wake-up that need nothing due). */
export function parkAllPlatformEvents(): void {
  runLocalSql(
    "update public.platform_events set notified_at = now() where notified_at is null",
  );
}
