import type { MeResponse } from "@/shared/api/me";

type Memberships = Pick<MeResponse, "workspaces" | "lastWorkspaceSlug">;

/** The workspace someone works in by default: the last one opened, else the first, else none. */
export function homeWorkspaceSlug(me: Memberships): string | null {
  return me.lastWorkspaceSlug ?? me.workspaces[0]?.slug ?? null;
}

/**
 * Where to go after sign-in (spec §7.1, §7.4): a safe `next`, else the home workspace, else
 * `/invites` (members without a workspace).
 */
export function resolvePostSignInPath(
  me: Memberships,
  next: string | null,
): string {
  if (next) {
    return next;
  }
  const slug = homeWorkspaceSlug(me);
  return slug ? `/w/${slug}` : "/invites";
}
