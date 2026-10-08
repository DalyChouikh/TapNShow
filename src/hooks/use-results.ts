"use client";

import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { PAGE_SIZE_MAX } from "@/config/pagination";
import { RESULTS_POLL_MS } from "@/config/responses";
import { usePagedList } from "@/hooks/use-paged-list";
import { apiRequest } from "@/lib/api-client";
import type { Page } from "@/shared/api/pagination";
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

/** A meeting's counts (tiles, email line, send progress); refreshed every 10 s while `live`. */
export function useMeetingResults(slug: string, id: string, live: boolean) {
  return useQuery({
    queryKey: meetingResultsKey(slug, id),
    queryFn: () =>
      apiRequest(`${meetingBase(slug, id)}/results`, {
        schema: meetingResultsSchema,
      }),
    refetchInterval: live ? RESULTS_POLL_MS : false,
    refetchIntervalInBackground: false,
  });
}

/** A meeting's people for one filter, paged; refreshed with the counts while `live`. */
export function useMeetingPeople(
  slug: string,
  id: string,
  filter: PeopleFilter,
  live: boolean,
) {
  return usePagedList({
    queryKey: ["meeting-people", slug, id, filter],
    path: `${meetingBase(slug, id)}/people`,
    params: { filter },
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

/** Every row of a paged endpoint, following `nextCursor` (exports only). */
async function fetchAll<T>(
  path: string,
  params: Record<string, string>,
  schema: z.ZodType<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({
      ...params,
      limit: String(PAGE_SIZE_MAX),
      ...(cursor ? { cursor } : {}),
    });
    const page: Page<T> = await apiRequest(`${path}?${query.toString()}`, {
      schema,
    });
    rows.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return rows;
}

/** All per-person, per-meeting rows of a period (Attendance export). */
export function fetchAllAttendanceDetails(
  slug: string,
  range: PeriodRange,
): Promise<AttendanceDetailRow[]> {
  return fetchAll(
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
  return fetchAll(
    `${meetingBase(slug, id)}/people`,
    { filter: "all" },
    peoplePageSchema,
  );
}
