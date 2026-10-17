import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addDays, addHours } from "date-fns";
import { beforeEach, describe, expect, it } from "vitest";
import { DEVICE_KEYS, REMINDERS_NOT_NOW_DAYS } from "@/config/members";
import { workspaceFixture } from "@/test/fixtures/me";
import { expectNothingShown, renderWithProviders } from "@/test/render";
import type { ReadySetup } from "./home-checklist";
import { SheetsTip } from "./sheets-tip";

const NOW = new Date("2026-10-17T10:00:00.000Z");
const complete: ReadySetup = {
  state: "ready",
  done: {
    importMembers: true,
    connectGmail: true,
    inviteCommittee: false,
    connectSheets: false,
  },
  complete: true,
  ownerName: "Daly",
};

beforeEach(() => localStorage.clear());

describe("SheetsTip", () => {
  it("shows to the Owner when setup is done and Sheets isn't connected", () => {
    renderWithProviders(
      <SheetsTip workspace={workspaceFixture} setup={complete} now={NOW} />,
    );
    expect(
      screen.getByRole("heading", {
        name: "Keep a Google Sheet of every answer",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect" })).toHaveAttribute(
      "href",
      "/w/robotics-cd34/settings#sheets",
    );
  });

  it.each([
    ["an Admin", { ...workspaceFixture, myRole: "admin" as const }, complete],
    [
      "setup isn't done",
      workspaceFixture,
      {
        ...complete,
        complete: false,
        done: { ...complete.done, connectGmail: false },
      },
    ],
    [
      "Sheets is connected",
      workspaceFixture,
      { ...complete, done: { ...complete.done, connectSheets: true } },
    ],
  ])("stays hidden for %s", (_, workspace, setup) => {
    renderWithProviders(
      <SheetsTip workspace={workspace} setup={setup} now={NOW} />,
    );
    expectNothingShown();
  });

  it("Not now hides it for REMINDERS_NOT_NOW_DAYS days on this device", async () => {
    const first = renderWithProviders(
      <SheetsTip workspace={workspaceFixture} setup={complete} now={NOW} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expectNothingShown();
    expect(localStorage.getItem(DEVICE_KEYS.sheetsTipHiddenUntil)).toBe(
      addHours(NOW, REMINDERS_NOT_NOW_DAYS * 24).toISOString(),
    );
    first.unmount();

    const later = renderWithProviders(
      <SheetsTip
        workspace={workspaceFixture}
        setup={complete}
        now={addDays(NOW, REMINDERS_NOT_NOW_DAYS - 1)}
      />,
    );
    expectNothingShown();
    later.unmount();

    renderWithProviders(
      <SheetsTip
        workspace={workspaceFixture}
        setup={complete}
        now={addDays(NOW, REMINDERS_NOT_NOW_DAYS + 1)}
      />,
    );
    expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
  });
});
