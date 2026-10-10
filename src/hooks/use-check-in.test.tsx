import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { MEETING_IDS, peopleFixture } from "@/test/fixtures/meetings";
import { useMarkAttendance } from "./use-check-in";
import { useMeetingPeople } from "./use-results";

const base = `/api/workspaces/club-ab12/meetings/${MEETING_IDS.meeting}`;
const [amira, youssef] = peopleFixture;
const markOf = (actual: string) => ({
  mark: { actual, markedAt: "2026-10-09T17:05:00.000Z", markedByName: "Daly" },
});

function setup(
  put: (body: {
    inviteeId: string;
    actual: string | null;
  }) => Promise<Response> | Response,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const spy = vi.spyOn(queryClient, "invalidateQueries");
  routeFetch({
    [`GET ${base}/people?filter=all&limit=50`]: json({
      items: peopleFixture,
      nextCursor: null,
    }),
    [`PUT ${base}/check-in`]: (init) => put(JSON.parse(String(init?.body))),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => ({
      people: useMeetingPeople("club-ab12", MEETING_IDS.meeting, "all", false),
      mark: useMarkAttendance("club-ab12", MEETING_IDS.meeting),
    }),
    { wrapper },
  );
  const markOfRow = (inviteeId: string) =>
    result.current.people.items.find((p) => p.inviteeId === inviteeId)?.mark
      ?.actual ?? null;
  return { result, spy, markOfRow };
}

describe("useMarkAttendance", () => {
  it("shows the mark at once, keeps the server's answer, and refreshes the counts", async () => {
    let release: () => void = () => undefined;
    const { result, spy, markOfRow } = setup(
      (body) =>
        new Promise((resolve) => {
          release = () => resolve(json(markOf(body.actual ?? ""))());
        }),
    );
    await waitFor(() => expect(result.current.people.items).toHaveLength(2));
    act(() =>
      result.current.mark.mutate({
        inviteeId: amira.inviteeId,
        actual: "absent",
      }),
    );
    await waitFor(() => expect(markOfRow(amira.inviteeId)).toBe("absent"));
    await act(async () => release());
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({
        queryKey: ["meeting-results", "club-ab12", MEETING_IDS.meeting],
      }),
    );
    expect(markOfRow(amira.inviteeId)).toBe("absent");
  });

  it("puts the mark back when saving fails", async () => {
    const { result, markOfRow } = setup(
      () =>
        new Response(JSON.stringify({ error: { code: "check_in_closed" } }), {
          status: 409,
        }),
    );
    await waitFor(() => expect(result.current.people.items).toHaveLength(2));
    await act(async () => {
      await result.current.mark
        .mutateAsync({ inviteeId: amira.inviteeId, actual: "present" })
        .catch(() => undefined);
    });
    expect(markOfRow(amira.inviteeId)).toBeNull();
  });

  it("sends one request at a time per person, so quick taps end on the last one", async () => {
    const order: string[] = [];
    const pending: (() => void)[] = [];
    const { result, markOfRow } = setup(
      (body) =>
        new Promise((resolve) => {
          order.push(`${body.inviteeId}:${body.actual}`);
          pending.push(() => resolve(json(markOf(body.actual ?? ""))()));
        }),
    );
    await waitFor(() => expect(result.current.people.items).toHaveLength(2));
    act(() => {
      result.current.mark.mutate({
        inviteeId: amira.inviteeId,
        actual: "present",
      });
      result.current.mark.mutate({
        inviteeId: amira.inviteeId,
        actual: "late",
      });
      result.current.mark.mutate({
        inviteeId: youssef.inviteeId,
        actual: "absent",
      });
    });
    // Amira's second tap waits for her first; Youssef's goes out at once.
    await waitFor(() =>
      expect(order).toEqual([
        `${amira.inviteeId}:present`,
        `${youssef.inviteeId}:absent`,
      ]),
    );
    await act(async () => pending.shift()?.());
    await waitFor(() => expect(order).toHaveLength(3));
    expect(order[2]).toBe(`${amira.inviteeId}:late`);
    await act(async () => {
      for (const resolve of pending.splice(0)) {
        resolve();
      }
    });
    await waitFor(() => expect(markOfRow(amira.inviteeId)).toBe("late"));
  });
});
