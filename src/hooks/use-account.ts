"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { accountSummarySchema } from "@/shared/api/account";

/** Query key of what `/account` shows (owned workspaces and counts). */
export const ACCOUNT_QUERY_KEY = ["account"] as const;

/** Owned workspaces, workspace count and answers with words (`GET /api/me/account`). */
export function useAccount() {
  return useQuery({
    queryKey: ACCOUNT_QUERY_KEY,
    queryFn: () =>
      apiRequest("/api/me/account", { schema: accountSummarySchema }),
  });
}
