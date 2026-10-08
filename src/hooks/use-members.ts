"use client";

import { usePagedList } from "@/hooks/use-paged-list";
import type { WorkspaceRole } from "@/shared/api/me";
import { membersPageSchema } from "@/shared/api/members";

/** Query key prefix of a workspace's members (invalidate it after a change). */
export const membersQueryKey = (slug: string) => ["members", slug] as const;

/**
 * Members of `/w/[slug]`, paged (`GET …/members`, #174); `role` narrows to one role (the transfer
 * dialog lists Admins only).
 */
export function useMembersPage(
  slug: string,
  options: { role?: WorkspaceRole; limit?: number; enabled?: boolean } = {},
) {
  return usePagedList({
    queryKey: [...membersQueryKey(slug), options.role ?? "all"],
    path: `/api/workspaces/${encodeURIComponent(slug)}/members`,
    params: options.role ? { role: options.role } : {},
    schema: membersPageSchema,
    limit: options.limit,
    enabled: options.enabled,
  });
}
