import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { routeFetch } from "@/test/fetch";
import { MEETING_IDS } from "@/test/fixtures/meetings";
import {
  useCancelMeeting,
  useEditPreview,
  useNudgeMeeting,
  useSaveEdit,
} from "./use-meeting-lifecycle";

const base = `/api/workspaces/club-ab12/meetings/${MEETING_IDS.meeting}`;
const result = {
  changed: true,
  changes: { title: ["Old", "New"] },
  emails: 0,
  calendarOnly: 1,
  reconfirm: false,
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const spy = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { spy, wrapper };
}

const keys = (spy: ReturnType<typeof setup>["spy"]) =>
  spy.mock.calls.map(([filters]) => filters?.queryKey);

describe("edit hooks", () => {
  it("previews with a dry run, only when enabled", async () => {
    const bodies: string[] = [];
    routeFetch({
      [`POST ${base}/changes`]: (init) => {
        bodies.push(String(init?.body));
        return new Response(JSON.stringify(result));
      },
    });
    const { wrapper } = setup();
    const fields = { title: "New" };
    const { result: off } = renderHook(
      () =>
        useEditPreview("club-ab12", MEETING_IDS.meeting, fields, false, false),
      { wrapper },
    );
    expect(off.current.fetchStatus).toBe("idle");
    const { result: on } = renderHook(
      () =>
        useEditPreview("club-ab12", MEETING_IDS.meeting, fields, false, true),
      { wrapper },
    );
    await waitFor(() => expect(on.current.data).toEqual(result));
    expect(JSON.parse(bodies[0])).toEqual({
      fields,
      notify: false,
      dryRun: true,
    });
  });

  it("saves for real and refreshes the meeting, its results, people and the list", async () => {
    routeFetch({
      [`POST ${base}/changes`]: () => new Response(JSON.stringify(result)),
    });
    const { spy, wrapper } = setup();
    const { result: save } = renderHook(
      () => useSaveEdit("club-ab12", MEETING_IDS.meeting),
      { wrapper },
    );
    await act(() =>
      save.current.mutateAsync({ fields: { title: "New" }, notify: false }),
    );
    expect(keys(spy)).toEqual([
      ["meeting", "club-ab12", MEETING_IDS.meeting],
      ["meeting-results", "club-ab12", MEETING_IDS.meeting],
      ["meeting-people", "club-ab12", MEETING_IDS.meeting],
      ["meetings", "club-ab12"],
    ]);
  });
});

describe("cancel and nudge hooks", () => {
  it("cancels and refreshes the same keys", async () => {
    routeFetch({
      [`POST ${base}/cancel`]: () =>
        new Response(JSON.stringify({ emails: 3 })),
    });
    const { spy, wrapper } = setup();
    const { result: cancel } = renderHook(
      () => useCancelMeeting("club-ab12", MEETING_IDS.meeting),
      { wrapper },
    );
    expect(await act(() => cancel.current.mutateAsync())).toEqual({
      emails: 3,
    });
    expect(keys(spy)).toContainEqual(["meetings", "club-ab12"]);
  });

  it("nudges and refreshes the results", async () => {
    routeFetch({
      [`POST ${base}/nudge`]: () =>
        new Response(
          JSON.stringify({ reminded: 2, nextAt: "2026-10-11T06:00:00.000Z" }),
        ),
    });
    const { spy, wrapper } = setup();
    const { result: nudge } = renderHook(
      () => useNudgeMeeting("club-ab12", MEETING_IDS.meeting),
      { wrapper },
    );
    await act(() => nudge.current.mutateAsync());
    expect(keys(spy)).toEqual([
      ["meeting-results", "club-ab12", MEETING_IDS.meeting],
    ]);
  });
});
