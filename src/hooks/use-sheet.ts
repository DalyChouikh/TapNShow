"use client";

import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { SHEET_STATUS_POLL_MS } from "@/config/sheets";
import { senderQueryKey } from "@/hooks/use-sender";
import { apiRequest } from "@/lib/api-client";
import { sheetUrl, tabForMeeting } from "@/lib/sheets/url";
import { okSchema } from "@/shared/api/common";
import { sheetStatusSchema } from "@/shared/api/sheets";

/** Query key of a workspace's Google Sheet status. */
export const sheetQueryKey = (slug: string) => ["sheet", slug] as const;

const path = (slug: string) =>
  `/api/workspaces/${encodeURIComponent(slug)}/sheet`;

/** The status query both hooks below read (one cache entry per workspace). */
const sheetQueryOptions = (slug: string) =>
  queryOptions({
    queryKey: sheetQueryKey(slug),
    queryFn: () => apiRequest(path(slug), { schema: sheetStatusSchema }),
  });

/**
 * The workspace's Google Sheet (spec §7.17). Polls only while it matters: while the file is being
 * created, and after Try again (`following`) until the sheet is up to date.
 */
export function useWorkspaceSheet(
  slug: string,
  options: { following?: boolean } = {},
) {
  return useQuery({
    ...sheetQueryOptions(slug),
    refetchInterval: (query) => {
      const data = query.state.data;
      const live =
        data?.state === "creating" ||
        (options.following === true && data?.behind === true);
      return live ? SHEET_STATUS_POLL_MS : false;
    },
  });
}

/**
 * Owner: Turn off. The account may be released, which changes my connections in Sending too, so
 * both are refreshed.
 */
export function useTurnOffSheet(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(path(slug), { method: "DELETE", schema: okSchema }),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: sheetQueryKey(slug) }),
        queryClient.invalidateQueries({ queryKey: senderQueryKey(slug) }),
      ]),
  });
}

/** Owner: Try again (rate limited). */
export function useRetrySheet(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest(`${path(slug)}/retry`, { method: "POST", schema: okSchema }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: sheetQueryKey(slug) }),
  });
}

/**
 * "Open the Google Sheet" in the Export menus: the meeting's year tab (or the newest tab), or
 * "paused"; null while loading or when the workspace has no sheet. Never polls.
 */
export function useSheetLink(
  slug: string,
  meeting?: { startsAt: string | null; timezone: string },
): { href: string | null; paused: boolean } | null {
  const { data } = useQuery(sheetQueryOptions(slug));
  if (!data || data.state === "off") {
    return null;
  }
  if (data.state === "paused") {
    return { href: null, paused: true };
  }
  if (!data.spreadsheetId) {
    return null;
  }
  return {
    href: sheetUrl(
      data.spreadsheetId,
      tabForMeeting(
        data.tabs,
        meeting?.startsAt ?? null,
        meeting?.timezone ?? "UTC",
      ),
    ),
    paused: false,
  };
}
