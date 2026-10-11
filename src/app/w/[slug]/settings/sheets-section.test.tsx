import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sheetUrl } from "@/lib/sheets/url";
import { googleConnectHref } from "@/shared/api/google-connect";
import type { SheetStatus } from "@/shared/api/sheets";
import { json, routeFetch } from "@/test/fetch";
import { workspaceFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { SheetsSection } from "./sheets-section";

const mocks = vi.hoisted(() => ({ goTo: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/w/robotics-cd34/settings",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/navigation", () => ({ goTo: mocks.goTo }));

const PATH = "/api/workspaces/robotics-cd34/sheet";
const FILE = "file-abcdefghij";
const status = (over: Partial<SheetStatus> = {}): SheetStatus => ({
  state: "on",
  spreadsheetId: FILE,
  pausedReason: null,
  syncedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
  behind: false,
  createdAt: "2026-10-10T09:00:00.000Z",
  turnedOnBy: "Amira Ben Ali",
  accountEmail: "club@gmail.com",
  ownerName: "Amira Ben Ali",
  tabs: [{ year: 2026, googleSheetId: 11, startsFrom: null, startsTo: null }],
  ...over,
});
const off = status({
  state: "off",
  spreadsheetId: null,
  syncedAt: null,
  createdAt: null,
  turnedOnBy: "",
  accountEmail: null,
  tabs: [],
});
const viewer = { ...workspaceFixture, myRole: "viewer" as const };
const dialog = () => within(screen.getByRole("dialog"));

afterEach(() => vi.clearAllMocks());

describe("SheetsSection", () => {
  it("Owner, off: explains, then asks before going to Google", async () => {
    routeFetch({ [`GET ${PATH}`]: json(off) });
    renderWithProviders(<SheetsSection workspace={workspaceFixture} />);
    expect(
      await screen.findByText(/Keep a live copy of every answer/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/use your group's own Google account/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Connect Google Sheets" }),
    );
    expect(
      dialog().getByText("Create a Google Sheet for Robotics Club?"),
    ).toBeInTheDocument();
    expect(
      dialog().getByText(/Anyone you share it with can see all of it/),
    ).toBeInTheDocument();
    await userEvent.click(
      dialog().getByRole("button", { name: "Continue to Google" }),
    );
    expect(mocks.goTo).toHaveBeenCalledWith(
      googleConnectHref("robotics-cd34", "sheets"),
    );
  });

  it("creating: says the sheet is being made", async () => {
    routeFetch({
      [`GET ${PATH}`]: json(
        status({ state: "creating", spreadsheetId: null, tabs: [] }),
      ),
    });
    renderWithProviders(<SheetsSection workspace={workspaceFixture} />);
    expect(
      await screen.findByText("Creating your Google Sheet…"),
    ).toBeInTheDocument();
  });

  it("creating: the Owner can still turn it off (final review)", async () => {
    routeFetch({
      [`GET ${PATH}`]: json(
        status({ state: "creating", spreadsheetId: null, tabs: [] }),
      ),
    });
    renderWithProviders(<SheetsSection workspace={workspaceFixture} />);
    await screen.findByText("Creating your Google Sheet…");
    await userEvent.click(
      screen.getByRole("button", { name: "Turn off the Google Sheet" }),
    );
    expect(
      dialog().getByText("Turn off the Google Sheet?"),
    ).toBeInTheDocument();
  });

  it("Try again and Turn off say why they failed (final review)", async () => {
    const failure = (status: number, code: string) => () =>
      new Response(JSON.stringify({ error: { code } }), { status });
    routeFetch({
      [`GET ${PATH}`]: json(
        status({ state: "paused", pausedReason: "trashed" }),
      ),
      [`POST ${PATH}/retry`]: failure(429, "rate_limited"),
      [`DELETE ${PATH}`]: failure(500, "internal"),
    });
    renderWithProviders(<SheetsSection workspace={workspaceFixture} />, {
      toaster: true,
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Try again" }),
    );
    expect(
      await screen.findByText("Too many attempts. Wait a bit and try again."),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Turn off the Google Sheet" }),
    );
    await userEvent.click(
      dialog().getByRole("button", { name: "Turn off the Google Sheet" }),
    );
    expect(
      await screen.findByText("Something went wrong on our side. Try again."),
    ).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Owner, on: names the file and account, opens, copies, and turns off after confirming", async () => {
    const fetchMock = routeFetch({
      [`GET ${PATH}`]: json(status()),
      [`DELETE ${PATH}`]: json({ ok: true }),
    });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderWithProviders(<SheetsSection workspace={workspaceFixture} />, {
      toaster: true,
    });
    expect(
      await screen.findByText("Robotics Club · TapNShow"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "In club@gmail.com's Drive · turned on by Amira Ben Ali on 10 Oct 2026",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Up to date")).toBeInTheDocument();
    expect(screen.getByText("Updated 2 minutes ago")).toBeInTheDocument();
    const open = screen.getByRole("link", { name: "Open the Google Sheet" });
    expect(open).toHaveAttribute("href", sheetUrl(FILE));
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");
    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(sheetUrl(FILE));
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Turn off the Google Sheet" }),
    );
    expect(
      dialog().getByText(
        "The sheet stops updating. It stays in club@gmail.com's Drive.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(
      dialog().getByRole("button", { name: "Turn off the Google Sheet" }),
    );
    expect(
      await screen.findByText("Google Sheet turned off"),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(true);
  });

  it("Owner, on and behind: says it is updating", async () => {
    routeFetch({ [`GET ${PATH}`]: json(status({ behind: true })) });
    renderWithProviders(<SheetsSection workspace={workspaceFixture} />);
    expect(await screen.findByText("Updating…")).toBeInTheDocument();
  });

  it("paused in the trash: Try again, Create a new sheet after confirming, and Turn off", async () => {
    const fetchMock = routeFetch({
      [`GET ${PATH}`]: json(
        status({ state: "paused", pausedReason: "trashed" }),
      ),
      [`POST ${PATH}/retry`]: json({ ok: true }),
    });
    renderWithProviders(<SheetsSection workspace={workspaceFixture} />);
    expect(await screen.findByText(/moved to the trash/)).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => init?.method === "POST" && url === `${PATH}/retry`,
      ),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Turn off the Google Sheet" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Create a new sheet" }),
    );
    expect(
      dialog().getByText("Create a new Google Sheet?"),
    ).toBeInTheDocument();
    await userEvent.click(
      dialog().getByRole("button", { name: "Continue to Google" }),
    );
    expect(mocks.goTo).toHaveBeenCalledWith(
      googleConnectHref("robotics-cd34", "sheets", { replace: true }),
    );
  });

  it("paused with a full Drive: says so, with Try again (#291)", async () => {
    routeFetch({
      [`GET ${PATH}`]: json(
        status({ state: "paused", pausedReason: "drive_full" }),
      ),
    });
    renderWithProviders(<SheetsSection workspace={workspaceFixture} />);
    expect(
      await screen.findByText(
        "The Google Drive holding the sheet is full. Free some space in it, then tap Try again. Or create a new one.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("paused without access: Reconnect Google goes straight to Google", async () => {
    routeFetch({
      [`GET ${PATH}`]: json(
        status({ state: "paused", pausedReason: "access_lost" }),
      ),
    });
    renderWithProviders(<SheetsSection workspace={workspaceFixture} />);
    expect(
      await screen.findByText(
        "TapNShow can no longer update the Google Sheet.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Reconnect Google" }),
    ).toHaveAttribute("href", googleConnectHref("robotics-cd34", "sheets"));
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });

  it("Viewer, on: the link and who to ask for access, nothing to change", async () => {
    routeFetch({ [`GET ${PATH}`]: json(status({ accountEmail: null })) });
    renderWithProviders(<SheetsSection workspace={viewer} />);
    expect(
      await screen.findByText(
        "Answers are copied to a Google Sheet. Updated 2 minutes ago.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open the Google Sheet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "If Google says you need access, ask Amira Ben Ali, the Owner, to share it with you.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Turn off the Google Sheet" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/club@gmail.com/)).not.toBeInTheDocument();
  });

  it("Viewer, off or paused: plain words and no link", async () => {
    routeFetch({ [`GET ${PATH}`]: json(off) });
    const { unmount } = renderWithProviders(
      <SheetsSection workspace={viewer} />,
    );
    expect(
      await screen.findByText(
        "Amira Ben Ali, the Owner, can turn on a Google Sheet copy of the answers.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    unmount();
    routeFetch({
      [`GET ${PATH}`]: json(
        status({
          state: "paused",
          pausedReason: "deleted",
          accountEmail: null,
        }),
      ),
    });
    renderWithProviders(<SheetsSection workspace={viewer} />);
    expect(
      await screen.findByText("The Google Sheet is paused."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
