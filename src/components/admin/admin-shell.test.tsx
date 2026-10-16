import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useAdminOverview,
  useAdminWorkspace,
  useSuspendWorkspace,
} from "@/hooks/use-admin";
import { ADMIN_WORKSPACE_ID } from "@/test/fixtures/admin";
import { meFixture } from "@/test/fixtures/me";
import { json, routeFetch, type FetchRoute } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { AdminShell } from "./admin-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/workspaces",
  useRouter: () => ({ replace: vi.fn() }),
}));

afterEach(() => vi.unstubAllGlobals());

const adminMe = { ...meFixture, platformRole: "admin" as const };
const notFound = json({ error: { code: "not_found" } }, 404);

/** `/api/me` answers `first`, then `then` on every later call. */
function meSequence(first: object, then: object): FetchRoute {
  let calls = 0;
  return () => {
    calls += 1;
    return new Response(JSON.stringify(calls === 1 ? first : then));
  };
}

function OverviewProbe() {
  const overview = useAdminOverview(30);
  return <p>{overview.data ? "figures" : "probe"}</p>;
}

function WorkspaceProbe() {
  const workspace = useAdminWorkspace(ADMIN_WORKSPACE_ID);
  return <p>{workspace.isError ? "workspace gone" : "probe"}</p>;
}

function SuspendProbe() {
  const suspend = useSuspendWorkspace(ADMIN_WORKSPACE_ID);
  return (
    <button type="button" onClick={() => suspend.mutate()}>
      Pause it
    </button>
  );
}

describe("AdminShell", () => {
  it("shows a platform admin the five tabs, the current one marked, and the page", async () => {
    routeFetch({ "GET /api/me": json(adminMe) });
    renderWithProviders(<AdminShell>content</AdminShell>);
    expect(await screen.findByText("content")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Admin" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("aria-label") ?? link.textContent),
    ).toEqual(["Overview", "Workspaces", "Reports", "Admins", "Log"]);
    // "Workspaces" doesn't fit five tabs on a 320 px phone: the bar shows "Spaces".
    expect(
      within(nav).getByRole("link", { name: "Workspaces" }),
    ).toHaveTextContent("SpacesWorkspaces");
    expect(screen.getByRole("link", { name: "Workspaces" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "App" })).toHaveAttribute(
      "href",
      "/welcome",
    );
  });

  it("shows anyone else the not-found view and never the page", async () => {
    routeFetch({ "GET /api/me": json(meFixture) });
    renderWithProviders(<AdminShell>content</AdminShell>);
    expect(
      await screen.findByRole("heading", { name: "We can't find that page" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("content")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Admin" })).toBeNull();
  });

  it("shows a busy skeleton, not the page, while it learns who is asking", () => {
    routeFetch({ "GET /api/me": () => new Promise<Response>(() => {}) });
    renderWithProviders(<AdminShell>content</AdminShell>);
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("content")).toBeNull();
  });

  it("shows the not-found view when a read answers 404 (removed while the page is open)", async () => {
    routeFetch({
      "GET /api/me": meSequence(adminMe, meFixture),
      "GET /api/admin/overview?days=30": notFound,
    });
    renderWithProviders(
      <AdminShell>
        <OverviewProbe />
      </AdminShell>,
    );
    expect(
      await screen.findByRole("heading", { name: "We can't find that page" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("probe")).toBeNull();
  });

  it("shows the not-found view when a write answers 404", async () => {
    routeFetch({
      "GET /api/me": meSequence(adminMe, meFixture),
      [`POST /api/admin/workspaces/${ADMIN_WORKSPACE_ID}/suspension`]: notFound,
    });
    const user = userEvent.setup();
    renderWithProviders(
      <AdminShell>
        <SuspendProbe />
      </AdminShell>,
    );
    await user.click(await screen.findByRole("button", { name: "Pause it" }));
    expect(
      await screen.findByRole("heading", { name: "We can't find that page" }),
    ).toBeInTheDocument();
  });

  it("keeps an admin on the page when a 404 means only that workspace is gone", async () => {
    const fetchMock = routeFetch({
      "GET /api/me": json(adminMe),
      [`GET /api/admin/workspaces/${ADMIN_WORKSPACE_ID}`]: notFound,
    });
    renderWithProviders(
      <AdminShell>
        <WorkspaceProbe />
      </AdminShell>,
    );
    expect(await screen.findByText("workspace gone")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => url === "/api/me"),
      ).toHaveLength(2),
    );
    expect(screen.getByText("workspace gone")).toBeInTheDocument();
  });
});
