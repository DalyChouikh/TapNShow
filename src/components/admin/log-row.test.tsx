import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PLATFORM_EVENT_KINDS } from "@/lib/discord/platform-events";
import { ADMIN_WORKSPACE_ID, logItemFixture } from "@/test/fixtures/admin";
import { renderWithProviders } from "@/test/render";
import { LogRow } from "./log-row";

describe("LogRow", () => {
  it.each([
    ["auto_suspended", "Sending suspended automatically · Robotics Club"],
    ["suspended", "Sami suspended sending · Robotics Club"],
    ["lifted", "Sami lifted the suspension · Robotics Club"],
    ["report", "New report · Robotics Club"],
    ["report_reviewed", "Sami reviewed a report · Robotics Club"],
    ["admin_invited", "Sami invited l•••@example.test as an admin"],
    ["admin_joined", "l•••@example.test joined as an admin"],
    ["admin_removed", "Sami removed l•••@example.test as an admin"],
    ["invite_revoked", "Sami revoked the invite for l•••@example.test"],
    ["owner_set", "The platform owner was set"],
    ["platform_email_cap", "The platform email limit was reached for the day"],
    ["worker_failing", "A background job failed (emails)"],
  ] as const)("writes one sentence for %s", (kind, sentence) => {
    renderWithProviders(
      <LogRow
        item={logItemFixture({
          kind,
          facts: { email: "l•••@example.test", lane: "emails" },
        })}
      />,
    );
    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  it("has a sentence for every kind", () => {
    expect(PLATFORM_EVENT_KINDS).toHaveLength(12);
  });

  it("links to the workspace, with the time and the rule's numbers", () => {
    renderWithProviders(
      <LogRow
        item={logItemFixture({
          kind: "auto_suspended",
          actorName: null,
          facts: { reports: 3, people: 74 },
        })}
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      `/admin/workspaces/${ADMIN_WORKSPACE_ID}`,
    );
    expect(link).toHaveTextContent("3 Oct 21:05 · 3 of 74 people · 4.1%");
  });

  it("names a removed account as an admin and doesn't link a deleted workspace", () => {
    renderWithProviders(
      <LogRow item={logItemFixture({ actorName: null, workspaceId: null })} />,
    );
    expect(
      screen.getByText("An admin suspended sending · Robotics Club"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
