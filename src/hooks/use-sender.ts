"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { okSchema } from "@/shared/api/common";
import { workspaceSenderSchema } from "@/shared/api/sender";

/** Query key of a workspace's sender. */
export const senderQueryKey = (slug: string) => ["sender", slug] as const;

const base = (slug: string) => `/api/workspaces/${encodeURIComponent(slug)}`;

/** Where "Connect Gmail" navigates (a full page load: Google's consent screen follows). */
export function gmailConnectHref(slug: string, next?: string): string {
  const params = new URLSearchParams({ workspace: slug });
  if (next) {
    params.set("next", next);
  }
  return `/api/integrations/google/connect?${params.toString()}`;
}

/** The workspace's sender, usage and my connections. */
export function useWorkspaceSender(slug: string) {
  return useQuery({
    queryKey: senderQueryKey(slug),
    queryFn: () =>
      apiRequest(`${base(slug)}/sender`, { schema: workspaceSenderSchema }),
  });
}

/** Owner: "Use <address>". */
export function useSetSender(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) =>
      apiRequest(`${base(slug)}/sender`, {
        method: "PUT",
        body: { connectionId },
        schema: okSchema,
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: senderQueryKey(slug) }),
  });
}

/** The person who connected a Gmail disconnects it. */
export function useDisconnectGmail(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) =>
      apiRequest(`/api/integrations/google/connections/${connectionId}`, {
        method: "DELETE",
        schema: okSchema,
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: senderQueryKey(slug) }),
  });
}
