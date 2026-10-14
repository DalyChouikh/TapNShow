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

/**
 * One `/invites` tab as a growing list, with the Needs-your-answer count, the server time and
 * whether any page came from this device's saved copy. `enabled: false` waits (e.g. until the
 * device's saved chip is known).
 */
export function useMyInvites(
  tab: MyInvitesTab,
  filter: MyInvitesFilter,
  options: { enabled?: boolean } = {},
) {
  const list = usePagedList({
    queryKey: MY_INVITES_QUERY_KEY,
    path: "/api/me/invites",
    params: { tab, filter },
    schema: myInvitesPageSchema,
    enabled: options.enabled,
    // Offline, the request still goes out so the service worker can answer from its copy.
    networkMode: "offlineFirst",
  });
  const first = list.query.data?.pages[0];
  return {
    ...list,
    needsCount: first?.needsCount ?? 0,
    asOf: first?.asOf ?? null,
    saved: list.query.data?.pages.some((page) => page.saved) ?? false,
  };
}

/** The answer page of one of the person's invites (a personal link; never stored). */
export async function fetchMyInviteLink(inviteeId: string): Promise<string> {
  const { path } = await apiRequest(`/api/me/invites/${inviteeId}/link`, {
    schema: myInviteLinkSchema,
  });
  return path;
}
