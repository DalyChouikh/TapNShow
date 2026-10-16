import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { workspaceDetailFixture } from "@/test/fixtures/admin";
import { renderWithProviders } from "@/test/render";
import { WorkspaceFacts } from "./workspace-facts";

/** The definition next to the term `label`. */
function fact(label: string): string {
  return (
    screen.getByText(label, { selector: "dt" }).nextElementSibling
      ?.textContent ?? ""
  );
}

describe("WorkspaceFacts", () => {
  it("shows the workspace's facts with the Owner email masked", () => {
    const { container } = renderWithProviders(
      <WorkspaceFacts workspace={workspaceDetailFixture()} />,
    );
    expect(fact("Created")).toBe("2 Oct 2026");
    expect(fact("Owner")).toBe("Amira · a•••@example.test");
    expect(fact("Team")).toBe("1 Owner · 2 Admins · 3 Viewers");
    expect(fact("People")).toBe("74");
    expect(fact("Sender Gmail")).toBe("Connected");
    expect(fact("Google Sheet")).toBe("Off");
    expect(container).not.toHaveTextContent("amira@example.test");
  });

  it("shows the last 30 days", () => {
    renderWithProviders(
      <WorkspaceFacts workspace={workspaceDetailFixture()} />,
    );
    expect(
      screen.getByRole("heading", { name: "Last 30 days" }),
    ).toBeInTheDocument();
    expect(fact("Meetings sent")).toBe("6");
    expect(fact("Emails")).toBe("402");
    expect(
      screen.getByText("Emails", { selector: "dt" }).parentElement,
    ).toHaveTextContent("96% delivered · 16 failed");
    expect(fact("Reports")).toBe("3");
    expect(fact("Unsubscribes")).toBe("5");
  });

  it("copes with a workspace whose Owner left and nothing sent", () => {
    renderWithProviders(
      <WorkspaceFacts
        workspace={workspaceDetailFixture({
          ownerName: null,
          ownerEmail: null,
          team: { owner: 0, admin: 1, viewer: 0 },
          sender: "broken",
          sheet: "paused",
          last30: {
            meetingsSent: 0,
            emailsSent: 0,
            emailsFailed: 0,
            reports: 0,
            unsubscribes: 0,
          },
        })}
      />,
    );
    expect(fact("Owner")).toBe("–");
    expect(fact("Team")).toBe("0 Owners · 1 Admin · 0 Viewers");
    expect(fact("Sender Gmail")).toBe("Needs reconnecting");
    expect(fact("Google Sheet")).toBe("Paused");
    expect(
      screen.getByText("Emails", { selector: "dt" }).parentElement,
    ).toHaveTextContent("Emails0none sent");
  });
});
