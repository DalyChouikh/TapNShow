"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { invitesResponseSchema } from "@/shared/api/invites";

/** Query key of a workspace's open invites. */
export const invitesQueryKey = (slug: string) => ["invites", slug] as const;

/** Open invites (`GET /api/workspaces/[slug]/invites`); disabled for Viewers. */
export function useInvites(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: invitesQueryKey(slug),
    queryFn: () =>
      apiRequest(`/api/workspaces/${encodeURIComponent(slug)}/invites`, {
        schema: invitesResponseSchema,
      }),
    enabled,
  });
}
