import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
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

  it("refreshes the page after a refused write too (another admin acted first)", async () => {
    let reads = 0;
    routeFetch({
      [`GET /api/admin/workspaces/${ADMIN_WORKSPACE_ID}`]: () => {
        reads += 1;
        return json(workspaceDetailFixture({ suspended: reads > 1 }))();
      },
      [`POST /api/admin/workspaces/${ADMIN_WORKSPACE_ID}/suspension`]: json(
        { error: { code: "conflict" } },
        409,
      ),
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
    await act(async () => {
      await result.current.suspend.mutateAsync().catch(() => undefined);
    });
    await waitFor(() =>
      expect(result.current.workspace.data?.suspended).toBe(true),
    );
  });

  it("reads admin data afresh each time a page opens", async () => {
    const fetchMock = routeFetch({
      [`GET /api/admin/workspaces/${ADMIN_WORKSPACE_ID}`]: json(
        workspaceDetailFixture(),
      ),
    });
    function Page() {
      const workspace = useAdminWorkspace(ADMIN_WORKSPACE_ID);
      return <p>{workspace.data?.name ?? "loading"}</p>;
    }
    function Area({ open }: { open: boolean }) {
      return open ? <Page /> : null;
    }
    const { rerender } = render(<Area open />, { wrapper });
    expect(await screen.findByText("Robotics Club")).toBeInTheDocument();
    rerender(<Area open={false} />);
    rerender(<Area open />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
