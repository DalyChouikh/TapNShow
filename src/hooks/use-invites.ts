"use client";

import { usePagedList } from "@/hooks/use-paged-list";
import { invitesPageSchema } from "@/shared/api/invites";

/** Query key of a workspace's open invites. */
export const invitesQueryKey = (slug: string) => ["invites", slug] as const;

/** Open invites, paged (`GET /api/workspaces/[slug]/invites`, #174); disabled for Viewers. */
export function useInvitesPage(slug: string, enabled: boolean) {
  return usePagedList({
    queryKey: invitesQueryKey(slug),
    path: `/api/workspaces/${encodeURIComponent(slug)}/invites`,
    schema: invitesPageSchema,
    enabled,
  });
}
