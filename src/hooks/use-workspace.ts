"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { workspaceDetailsSchema } from "@/shared/api/workspaces";

/** Query key of one workspace. */
export const workspaceQueryKey = (slug: string) => ["workspace", slug] as const;

/** The workspace at `/w/[slug]` with the caller's role. */
export function useWorkspace(slug: string) {
  return useQuery({
    queryKey: workspaceQueryKey(slug),
    queryFn: () =>
      apiRequest(`/api/workspaces/${encodeURIComponent(slug)}`, {
        schema: workspaceDetailsSchema,
      }),
  });
}
