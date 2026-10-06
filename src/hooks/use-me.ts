"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { meResponseSchema } from "@/shared/api/me";

/** Query key of the signed-in user's profile and workspaces. */
export const ME_QUERY_KEY = ["me"] as const;

/** Signed-in user's profile and memberships (`GET /api/me`). */
export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => apiRequest("/api/me", { schema: meResponseSchema }),
  });
}
