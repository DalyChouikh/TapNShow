import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { workspaceFixture } from "@/test/fixtures/me";
import { expectNothingShown, renderWithProviders } from "@/test/render";
import { HomeChecklist, type ReadySetup } from "./home-checklist";

const pending: ReadySetup = {
  state: "ready",
  done: {
    importMembers: true,
    connectGmail: false,
    inviteCommittee: true,
    connectSheets: false,
  },
  complete: false,
  ownerName: "Daly",
};
const complete: ReadySetup = {
  ...pending,
  done: { ...pending.done, connectGmail: true },
  complete: true,
};
const admin = { ...workspaceFixture, myRole: "admin" as const };
const viewer = { ...workspaceFixture, myRole: "viewer" as const };

const step = (name: string) =>
  screen.getByText(name).closest("li") as HTMLElement;

describe("HomeChecklist", () => {
  it("marks each step Done from the roster, committee, sender and sheet", () => {
    renderWithProviders(
      <HomeChecklist workspace={workspaceFixture} setup={pending} />,
    );
    expect(
      screen.getByRole("heading", { name: "Get set up" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 of 2 needed")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "1 of 2 needed" }),
    ).toHaveAttribute("aria-valuenow", "1");
    for (const name of ["Import your members", "Invite your committee"]) {
      expect(within(step(name)).getByText("Done")).toBeInTheDocument();
      expect(within(step(name)).queryByRole("link")).toBeNull();
    }
    expect(
      within(step("Connect your group's Gmail")).getByRole("link", {
        name: "Connect",
      }),
    ).toHaveAttribute("href", "/w/robotics-cd34/settings#sending");
    expect(
      within(step("Sync answers to Google Sheets")).getByRole("link", {
        name: "Connect",
      }),
    ).toHaveAttribute("href", "/w/robotics-cd34/settings#sheets");
    expect(
      screen.getByText(
        "This card goes away once your members and Gmail are in.",
      ),
    ).toBeInTheDocument();
  });

  it("links import to the roster and invite to the committee settings", () => {
    renderWithProviders(
      <HomeChecklist
        workspace={workspaceFixture}
        setup={{
          ...pending,
          done: {
            ...pending.done,
            importMembers: false,
            inviteCommittee: false,
          },
        }}
      />,
    );
    expect(screen.getByText("0 of 2 needed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Import" })).toHaveAttribute(
      "href",
      "/w/robotics-cd34/lists",
    );
    expect(screen.getByRole("link", { name: "Invite" })).toHaveAttribute(
      "href",
      "/w/robotics-cd34/settings#people",
    );
  });

  it("disappears once members and Gmail are done", () => {
    renderWithProviders(
      <HomeChecklist workspace={workspaceFixture} setup={complete} />,
    );
    expectNothingShown();
  });

  it("asks Admins to ask the Owner for Gmail and Sheets", () => {
    renderWithProviders(<HomeChecklist workspace={admin} setup={pending} />);
    expect(screen.getAllByText("Ask Daly to connect")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "Connect" })).toBeNull();
  });

  it("shows Viewers the short welcome until setup is done", () => {
    const { unmount } = renderWithProviders(
      <HomeChecklist workspace={viewer} setup={pending} />,
    );
    expect(
      screen.getByRole("heading", { name: "You're a Viewer in Robotics Club" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    unmount();
    renderWithProviders(<HomeChecklist workspace={viewer} setup={complete} />);
    expectNothingShown();
  });
});
