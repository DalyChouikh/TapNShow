import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryProvider } from "@/components/providers/query-provider";
import {
  ADMIN_WORKSPACE_ID,
  workspaceDetailFixture,
} from "@/test/fixtures/admin";
import { json, routeFetch } from "@/test/fetch";
import {
  useAdminWorkspace,
  useAdminWorkspaces,
  useSuspendWorkspace,
} from "./use-admin";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryProvider>{children}</QueryProvider>
);
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
      [`GET /api/admin/workspaces/${ADMIN_WORKSPACE_ID}`]: () =>
        json(workspaceDetailFixture({ suspended }))(),
      [`POST /api/admin/workspaces/${ADMIN_WORKSPACE_ID}/suspension`]: () => {
        suspended = true;
        return json({ ok: true })();
      },
    });
    const { result } = renderHook(
      () => ({
        workspace: useAdminWorkspace(ADMIN_WORKSPACE_ID),
        suspend: useSuspendWorkspace(ADMIN_WORKSPACE_ID),
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
