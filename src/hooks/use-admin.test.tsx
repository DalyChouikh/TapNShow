import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryProvider } from "@/components/providers/query-provider";
import { json, routeFetch } from "@/test/fetch";
import {
  useAdminWorkspace,
  useAdminWorkspaces,
  useSuspendWorkspace,
} from "./use-admin";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryProvider>{children}</QueryProvider>
);
const ID = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const detail = (suspended: boolean) => ({
  id: ID,
  name: "Robotics Club",
  slug: "robotics-ab12",
  createdAt: "2026-10-02T10:00:00+00:00",
  ownerName: "Amira",
  ownerEmail: "amira@example.test",
  team: { owner: 1, admin: 1, viewer: 2 },
  contacts: 74,
  sender: "active",
  sheet: "off",
  suspended,
  last30: {
    meetingsSent: 6,
    emailsSent: 402,
    emailsFailed: 16,
    reports: 3,
    unsubscribes: 1,
  },
  reports7d: 3,
  people7d: 74,
  suspensions: [],
});

afterEach(() => vi.unstubAllGlobals());

describe("admin hooks", () => {
  it("asks for one page of 25 workspaces with the search, filter and sort", async () => {
    const fetchMock = routeFetch({
      "GET /api/admin/workspaces?q=robot&filter=reported&sort=reports&limit=25":
        json({
          items: [],
          nextCursor: null,
        }),
    });
    const { result } = renderHook(
      () =>
        useAdminWorkspaces({ q: "robot", filter: "reported", sort: "reports" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("leaves an empty search out of the request", async () => {
    const fetchMock = routeFetch({
      "GET /api/admin/workspaces?filter=all&sort=newest&limit=25": json({
        items: [],
        nextCursor: null,
      }),
    });
    const { result } = renderHook(
      () => useAdminWorkspaces({ q: "", filter: "all", sort: "newest" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("suspends through the API and reads the workspace again", async () => {
    let suspended = false;
    const fetchMock = routeFetch({
      [`GET /api/admin/workspaces/${ID}`]: () => json(detail(suspended))(),
      [`POST /api/admin/workspaces/${ID}/suspension`]: () => {
        suspended = true;
        return json({ ok: true })();
      },
    });
    const { result } = renderHook(
      () => ({
        workspace: useAdminWorkspace(ID),
        suspend: useSuspendWorkspace(ID),
      }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.workspace.data?.suspended).toBe(false),
    );
    await act(() => result.current.suspend.mutateAsync());
    await waitFor(() =>
      expect(result.current.workspace.data?.suspended).toBe(true),
    );
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(true);
  });
});
