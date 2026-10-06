"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { membersResponseSchema } from "@/shared/api/members";

/** Query key of a workspace's members. */
export const membersQueryKey = (slug: string) => ["members", slug] as const;

/** Members of `/w/[slug]` (`GET /api/workspaces/[slug]/members`). */
export function useMembers(slug: string) {
  return useQuery({
    queryKey: membersQueryKey(slug),
    queryFn: () =>
      apiRequest(`/api/workspaces/${encodeURIComponent(slug)}/members`, {
        schema: membersResponseSchema,
      }),
  });
}
