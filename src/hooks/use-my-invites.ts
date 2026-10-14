"use client";

import { usePagedList } from "@/hooks/use-paged-list";
import { apiRequest } from "@/lib/api-client";
import {
  type MyInvitesFilter,
  type MyInvitesTab,
  myInviteLinkSchema,
  myInvitesPageSchema,
} from "@/shared/api/my-invites";

/** Query key prefix of every `/invites` list (invalidated after answering or deleting). */
export const MY_INVITES_QUERY_KEY = ["my-invites"] as const;

/** One `/invites` tab as a growing list, with the Needs-your-answer count and the server time. */
export function useMyInvites(tab: MyInvitesTab, filter: MyInvitesFilter) {
  const list = usePagedList({
    queryKey: MY_INVITES_QUERY_KEY,
    path: "/api/me/invites",
    params: { tab, filter },
    schema: myInvitesPageSchema,
  });
  const first = list.query.data?.pages[0];
  return {
    ...list,
    needsCount: first?.needsCount ?? 0,
    asOf: first?.asOf ?? null,
  };
}

/** The answer page of one of the person's invites (a personal link; never stored). */
export async function fetchMyInviteLink(inviteeId: string): Promise<string> {
  const { path } = await apiRequest(`/api/me/invites/${inviteeId}/link`, {
    schema: myInviteLinkSchema,
  });
  return path;
}
