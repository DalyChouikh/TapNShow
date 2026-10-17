import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { QueryProvider } from "@/components/providers/query-provider";
import { json, routeFetch } from "@/test/fetch";
import { insightsFixture } from "@/test/fixtures/insights";
import type { PeriodRange } from "@/shared/api/responses";
import {
  fetchAllAttendanceDetails,
  useMeetingPeople,
  useMeetingResults,
  useWorkspaceInsights,
} from "./use-results";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryProvider>{children}</QueryProvider>
);
const base = "/api/workspaces/club-ab12";
const MEETING = "4b7f8c2e-2f3a-4c55-9a1e-0d6f6b1c2a10";
const results = {
  responseMode: "attendance",
  emails: { total: 1, queued: 0, sent: 1, skipped: 0, failed: 0, unknown: 0 },
  answers: {
    attending: 1,
    late: 0,
    absent: 0,
    notAttending: 0,
    noReply: 0,
    calendarRequested: 0,
    toReconfirm: 0,
    remindable: 0,
    reachable: 1,
  },
  paused: 0,
  resumesAt: null,
  senderState: "ok",
  checkedIn: 0,
  checkInTotal: 1,
  nudge: { lastAt: null, lastCount: null, nextAt: null },
};

describe("organizer hooks", () => {
  it("loads a meeting's counts and its people for a filter", async () => {
    routeFetch({
      [`GET ${base}/meetings/${MEETING}/results`]: json(results),
      [`GET ${base}/meetings/${MEETING}/people?filter=late&limit=50`]: json({
        items: [],
        nextCursor: null,
      }),
    });
    const { result } = renderHook(
      () => ({
        results: useMeetingResults("club-ab12", MEETING, true),
        people: useMeetingPeople("club-ab12", MEETING, "late", true),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.results.data).toEqual(results));
    await waitFor(() =>
      expect(result.current.people.query.isSuccess).toBe(true),
    );
  });

  it("follows every cursor for exports", async () => {
    const row = (n: number) => ({
      meetingId: MEETING,
      title: "Weekly sync",
      startsAt: "2026-10-01T17:00:00+00:00",
      timezone: "Africa/Tunis",
      responseMode: "attendance",
      inviteeId: `00000000-0000-4000-8000-00000000000${n}`,
      contactId: `10000000-0000-4000-8000-00000000000${n}`,
      fullName: `Member ${n}`,
      email: `m${n}@uni.tn`,
      emailStatus: "sent",
      answer: null,
      mark: null,
    });
    routeFetch({
      [`GET ${base}/attendance/details?from=2026-09-01T00%3A00%3A00.000Z&limit=100`]:
        json({ items: [row(1)], nextCursor: "c1" }),
      [`GET ${base}/attendance/details?from=2026-09-01T00%3A00%3A00.000Z&limit=100&cursor=c1`]:
        json({ items: [row(2)], nextCursor: null }),
    });
    const rows = await fetchAllAttendanceDetails("club-ab12", {
      from: "2026-09-01T00:00:00.000Z",
      to: null,
    });
    expect(rows.map((r) => r.fullName)).toEqual(["Member 1", "Member 2"]);
  });

  it("asks once per period and keeps the last insights while the next period loads", async () => {
    const lastThreeMonths: PeriodRange = {
      from: "2026-07-17T10:00:00.000Z",
      to: null,
    };
    const allTime: PeriodRange = { from: null, to: null };
    const fetchMock = routeFetch({
      [`GET ${base}/insights?from=2026-07-17T10%3A00%3A00.000Z`]:
        json(insightsFixture),
      // All time never answers here: the screen keeps the last numbers meanwhile.
      [`GET ${base}/insights`]: () => new Promise<Response>(() => {}),
    });
    const { result, rerender } = renderHook(
      ({ range }) => useWorkspaceInsights("club-ab12", range),
      { wrapper, initialProps: { range: lastThreeMonths } },
    );
    await waitFor(() => expect(result.current.data).toEqual(insightsFixture));

    rerender({ range: allTime });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data).toEqual(insightsFixture);

    rerender({ range: lastThreeMonths });
    expect(result.current.data).toEqual(insightsFixture);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
