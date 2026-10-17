"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { PROGRESS_POLL_MS } from "@/config/meetings";
import { RESULTS_POLL_MS } from "@/config/responses";
import { usePagedList } from "@/hooks/use-paged-list";
import { apiRequest } from "@/lib/api-client";
import { workspaceInsightsSchema } from "@/shared/api/insights";
import {
  type AttendanceDetailRow,
  attendanceDetailsPageSchema,
  attendanceSummarySchema,
  historyPageSchema,
  meetingResultsSchema,
  type PeopleFilter,
  peoplePageSchema,
  type PeriodRange,
  type PersonRow,
} from "@/shared/api/responses";
import { fetchAllPages } from "@/lib/api/fetch-all-pages";

const workspaceBase = (slug: string) =>
  `/api/workspaces/${encodeURIComponent(slug)}`;
const meetingBase = (slug: string, id: string) =>
  `${workspaceBase(slug)}/meetings/${id}`;

/** `?from=&to=` for a period (open bounds left out). */
function periodParams(range: PeriodRange): Record<string, string> {
  return {
    ...(range.from ? { from: range.from } : {}),
    ...(range.to ? { to: range.to } : {}),
  };
}

/** Query key of a meeting's counts. */
export const meetingResultsKey = (slug: string, id: string) =>
  ["meeting-results", slug, id] as const;

/** A meeting's counts (tiles, email line, send progress), refreshed while sending or `live`. */
export function useMeetingResults(slug: string, id: string, live: boolean) {
  return useQuery({
    queryKey: meetingResultsKey(slug, id),
    queryFn: () =>
      apiRequest(`${meetingBase(slug, id)}/results`, {
        schema: meetingResultsSchema,
      }),
    // Every 3 s while invites are still going out, every 10 s while the meeting is live.
    refetchInterval: (query) =>
      (query.state.data?.emails.queued ?? 0) > 0
        ? PROGRESS_POLL_MS
        : live
          ? RESULTS_POLL_MS
          : false,
    refetchIntervalInBackground: false,
  });
}

/** Prefix of every people-list key of one meeting (all filters); invalidate it after writes. */
export const meetingPeopleKey = (slug: string, id: string) =>
  ["meeting-people", slug, id] as const;

/** A meeting's people for one filter (and search), paged; refreshed with the counts while `live`. */
export function useMeetingPeople(
  slug: string,
  id: string,
  filter: PeopleFilter,
  live: boolean,
  search: string | null = null,
) {
  return usePagedList({
    queryKey: [...meetingPeopleKey(slug, id), filter, search ?? ""],
    path: `${meetingBase(slug, id)}/people`,
    params: search ? { filter, search } : { filter },
    schema: peoplePageSchema,
    refetchInterval: live ? RESULTS_POLL_MS : false,
  });
}

/** One person's history for a period: counts (from the first page) and paged past meetings. */
export function useContactHistory(
  slug: string,
  contactId: string,
  range: PeriodRange,
) {
  const list = usePagedList({
    queryKey: [
      "contact-history",
      slug,
      contactId,
      range.from ?? "",
      range.to ?? "",
    ],
    path: `${workspaceBase(slug)}/contacts/${contactId}/history`,
    params: periodParams(range),
    schema: historyPageSchema,
  });
  return { ...list, counts: list.query.data?.pages[0]?.counts ?? null };
}

/** The Attendance table's data for a period. */
export function useAttendance(slug: string, range: PeriodRange) {
  return useQuery({
    queryKey: ["attendance", slug, range.from ?? "", range.to ?? ""],
    queryFn: () => {
      const query = new URLSearchParams(periodParams(range)).toString();
      return apiRequest(
        `${workspaceBase(slug)}/attendance${query ? `?${query}` : ""}`,
        { schema: attendanceSummarySchema },
      );
    },
  });
}

/**
 * Home's insights for a period: one request per period (cached by its bounds). The last period's
 * numbers stay on screen while the next one loads, so the cards don't blink.
 */
export function useWorkspaceInsights(slug: string, range: PeriodRange) {
  return useQuery({
    queryKey: ["insights", slug, range.from ?? "", range.to ?? ""],
    queryFn: () => {
      const query = new URLSearchParams(periodParams(range)).toString();
      return apiRequest(
        `${workspaceBase(slug)}/insights${query ? `?${query}` : ""}`,
        { schema: workspaceInsightsSchema },
      );
    },
    placeholderData: keepPreviousData,
  });
}

/** All per-person, per-meeting rows of a period (Attendance export). */
export function fetchAllAttendanceDetails(
  slug: string,
  range: PeriodRange,
): Promise<AttendanceDetailRow[]> {
  return fetchAllPages(
    `${workspaceBase(slug)}/attendance/details`,
    periodParams(range),
    attendanceDetailsPageSchema,
  );
}

/** All of a meeting's people with their answers (meeting export). */
export function fetchAllMeetingPeople(
  slug: string,
  id: string,
): Promise<PersonRow[]> {
  return fetchAllPages(
    `${meetingBase(slug, id)}/people`,
    { filter: "all" },
    peoplePageSchema,
  );
}
