import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workspaceRowFixture } from "@/test/fixtures/admin";
import { json, routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { AdminWorkspacesView } from "./admin-workspaces";

const mocks = vi.hoisted(() => ({
  replace: vi.fn<(href: string, options?: { scroll?: boolean }) => void>(),
  params: { value: "" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => "/admin/workspaces",
  useSearchParams: () => new URLSearchParams(mocks.params.value),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.params.value = "";
});

const page = (items: object[], nextCursor: string | null = null) =>
  json({ items, nextCursor });

describe("AdminWorkspacesView", () => {
  it("lists every workspace newest first and says when the list ends", async () => {
    routeFetch({
      "GET /api/admin/workspaces?filter=all&sort=newest&limit=25": page([
        workspaceRowFixture,
      ]),
    });
    renderWithProviders(<AdminWorkspacesView />);
    expect(
      await screen.findByText("That's every workspace."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: /Robotics Club/ }).length,
    ).toBeGreaterThan(0);
  });

  it("searches after typing stops and keeps the view in the address", async () => {
    const fetchMock = routeFetch({
      "GET /api/admin/workspaces?filter=all&sort=newest&limit=25": page([
        workspaceRowFixture,
      ]),
      "GET /api/admin/workspaces?q=chess&filter=all&sort=newest&limit=25": page(
        [],
      ),
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminWorkspacesView />);
    await user.type(
      screen.getByRole("searchbox", { name: "Search by name or Owner email" }),
      "  chess ",
    );
    expect(
      await screen.findByText("No workspace matches."),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("q=")),
    ).toHaveLength(1);
    expect(mocks.replace).toHaveBeenLastCalledWith(
      "/admin/workspaces?q=chess",
      { scroll: false },
    );
  });

  it("starts from the address and filters with the chips", async () => {
    mocks.params.value = "filter=reported&sort=reports";
    routeFetch({
      "GET /api/admin/workspaces?filter=reported&sort=reports&limit=25": page([
        workspaceRowFixture,
      ]),
      "GET /api/admin/workspaces?filter=suspended&sort=reports&limit=25": page(
        [],
      ),
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminWorkspacesView />);
    expect(
      await screen.findByRole("radio", { name: "Reported" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveTextContent(
      "Most reports",
    );
    await user.click(screen.getByRole("radio", { name: "Suspended" }));
    expect(
      await screen.findByText("No workspace matches."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenLastCalledWith(
        "/admin/workspaces?filter=suspended&sort=reports",
        { scroll: false },
      ),
    );
  });

  it("ignores an unknown filter or sort in the address", async () => {
    mocks.params.value = "filter=everything&sort=oldest";
    routeFetch({
      "GET /api/admin/workspaces?filter=all&sort=newest&limit=25": page([]),
    });
    renderWithProviders(<AdminWorkspacesView />);
    expect(
      await screen.findByText("No workspace matches."),
    ).toBeInTheDocument();
  });

  it("loads 25 more on Show more", async () => {
    routeFetch({
      "GET /api/admin/workspaces?filter=all&sort=newest&limit=25": page(
        [workspaceRowFixture],
        "cursor-1",
      ),
      "GET /api/admin/workspaces?filter=all&sort=newest&limit=25&cursor=cursor-1":
        page([
          {
            ...workspaceRowFixture,
            id: "0b1f6a3e-5d0a-4a0e-9a49-3e2d0f5b9c11",
            name: "Chess Society",
          },
        ]),
    });
    const user = userEvent.setup();
    renderWithProviders(<AdminWorkspacesView />);
    await user.click(await screen.findByRole("button", { name: "Show more" }));
    expect(
      (await screen.findAllByRole("link", { name: /Chess Society/ })).length,
    ).toBeGreaterThan(0);
  });
});
