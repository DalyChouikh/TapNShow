"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import { answerSchema, type SubmitAnswerBody } from "@/shared/api/responses";
import { type TokenInfo, tokenInfoSchema } from "@/shared/api/tokens";

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

/** Saves the member's answer and shows it at once (spec §7.3). */
export function useSubmitAnswer(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SubmitAnswerBody) =>
      apiRequest(`/api/r/${token}/response`, {
        method: "PUT",
        body,
        schema: answerSchema,
        onUnauthenticated: noLogin,
      }),
    onSuccess: (answer) =>
      queryClient.setQueryData<TokenInfo>(key(token), (info) =>
        info ? { ...info, answer } : info,
      ),
  });
}

/** "Email me a calendar invite" on an announcement. */
export function useRequestCalendar(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(`/api/r/${token}/calendar`, {
        method: "POST",
        body: {},
        schema: okSchema,
        onUnauthenticated: noLogin,
      }),
    onSuccess: () =>
      queryClient.setQueryData<TokenInfo>(key(token), (info) =>
        info ? { ...info, calendarRequested: true } : info,
      ),
  });
}
