"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import { tokenInfoSchema } from "@/shared/api/tokens";

const key = (token: string) => ["token-page", token] as const;
const noLogin = () => undefined;

/** The personal link's public info (no session; a 401 never happens here). */
export function useTokenInfo(token: string) {
  return useQuery({
    queryKey: key(token),
    queryFn: () =>
      apiRequest(`/api/r/${token}`, {
        schema: tokenInfoSchema,
        onUnauthenticated: noLogin,
      }),
    retry: false,
  });
}

/** Unsubscribe / report / resubscribe, then refresh the info. */
export function useTokenAction(
  token: string,
  action: "unsubscribe" | "report" | "resubscribe",
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(`/api/r/${token}/${action}`, {
        method: "POST",
        body: {},
        schema: okSchema,
        onUnauthenticated: noLogin,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key(token) }),
  });
}
