import type { MeResponse } from "@/shared/api/me";

/** Where to go after sign-in (spec §7.1): safe `next`, else last workspace, else first, else create one. */
export function resolvePostSignInPath(
  me: Pick<MeResponse, "workspaces" | "lastWorkspaceSlug">,
  next: string | null,
): string {
  if (next) {
    return next;
  }
  const slug = me.lastWorkspaceSlug ?? me.workspaces[0]?.slug;
  return slug ? `/w/${slug}` : "/w/new";
}
