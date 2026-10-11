import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SheetStatus } from "@/shared/api/sheets";
import { json, routeFetch } from "@/test/fetch";
import {
  sheetQueryKey,
  useRetrySheet,
  useSheetLink,
  useTurnOffSheet,
  useWorkspaceSheet,
} from "./use-sheet";

const PATH = "/api/workspaces/club-ab12/sheet";
const status = (over: Partial<SheetStatus> = {}): SheetStatus => ({
  state: "on",
  spreadsheetId: "file-abcdefghij",
  pausedReason: null,
  syncedAt: "2026-10-12T21:15:00.000Z",
  behind: false,
  createdAt: "2026-10-10T09:00:00.000Z",
  turnedOnBy: "Daly",
  accountEmail: null,
  ownerName: "Daly",
  tabs: [
    {
      year: 2026,
      googleSheetId: 11,
      startsFrom: "2026-01-03T17:00:00.000Z",
      startsTo: "2026-10-15T17:00:00.000Z",
    },
    {
      year: 2025,
      googleSheetId: 12,
      startsFrom: "2025-02-01T17:00:00.000Z",
      startsTo: "2025-12-01T17:00:00.000Z",
    },
  ],
  ...over,
});

function wrapperWith(queryClient: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}
const client = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

afterEach(() => {
  vi.useRealTimers();
});

describe("useWorkspaceSheet", () => {
  it("polls every 3 s while the sheet is being created and stops once it is on", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const replies = [
      status({ state: "creating", spreadsheetId: null, tabs: [] }),
      status(),
    ];
    const fetchMock = routeFetch({
      [`GET ${PATH}`]: () =>
        new Response(JSON.stringify(replies.shift() ?? status())),
    });
    const { result } = renderHook(() => useWorkspaceSheet("club-ab12"), {
      wrapper: wrapperWith(client()),
    });
    await waitFor(() => expect(result.current.data?.state).toBe("creating"));
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    await waitFor(() => expect(result.current.data?.state).toBe("on"));
    const calls = fetchMock.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(9_000));
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});

describe("sheet mutations", () => {
  it("Turn off and Try again invalidate the sheet status (Turn off also the sender)", async () => {
    const queryClient = client();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    routeFetch({
      [`DELETE ${PATH}`]: json({ ok: true }),
      [`POST ${PATH}/retry`]: json({ ok: true }),
    });
    const { result } = renderHook(
      () => ({
        off: useTurnOffSheet("club-ab12"),
        retry: useRetrySheet("club-ab12"),
      }),
      { wrapper: wrapperWith(queryClient) },
    );
    await act(() => result.current.off.mutateAsync());
    expect(spy).toHaveBeenCalledWith({ queryKey: sheetQueryKey("club-ab12") });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["sender", "club-ab12"] });
    spy.mockClear();
    await act(() => result.current.retry.mutateAsync());
    expect(spy).toHaveBeenCalledWith({ queryKey: sheetQueryKey("club-ab12") });
  });
});

describe("useSheetLink", () => {
  const link = async (
    reply: SheetStatus,
    meeting?: { startsAt: string | null; timezone: string },
  ) => {
    routeFetch({ [`GET ${PATH}`]: json(reply) });
    const { result } = renderHook(() => useSheetLink("club-ab12", meeting), {
      wrapper: wrapperWith(client()),
    });
    await waitFor(() => expect(result.current).not.toBeUndefined());
    return result;
  };

  it("opens the meeting's year tab", async () => {
    const result = await link(status(), {
      startsAt: "2025-06-01T17:00:00.000Z",
      timezone: "Africa/Tunis",
    });
    await waitFor(() =>
      expect(result.current).toEqual({
        href: "https://docs.google.com/spreadsheets/d/file-abcdefghij/edit#gid=12",
        paused: false,
      }),
    );
  });

  it("says paused", async () => {
    const result = await link(
      status({ state: "paused", pausedReason: "trashed" }),
    );
    await waitFor(() =>
      expect(result.current).toEqual({ href: null, paused: true }),
    );
  });

  it("is null without a sheet", async () => {
    const result = await link(
      status({ state: "off", spreadsheetId: null, tabs: [] }),
    );
    await waitFor(() => expect(result.current).toBeNull());
  });
});
