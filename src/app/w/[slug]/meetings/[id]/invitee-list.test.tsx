import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { progressFixture } from "@/test/fixtures/meetings";
import { renderWithProviders } from "@/test/render";
import { InviteeList } from "./invitee-list";

const [sent, queued] = progressFixture.invitees;

describe("InviteeList", () => {
  it("shows each person's delivery state and why it failed", () => {
    renderWithProviders(
      <InviteeList
        invitees={[
          sent,
          queued,
          {
            ...queued,
            id: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6a1",
            fullName: "Unknown U.",
            status: "unknown",
            error: "delivery_unknown",
          },
          {
            ...queued,
            id: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6a2",
            fullName: "Failed F.",
            status: "failed",
            error: "Invalid To header",
          },
        ]}
      />,
    );
    const row = (name: string) =>
      within(screen.getByText(name).closest("li") as HTMLElement);
    expect(row("Amira B.").getByText("Sent")).toBeInTheDocument();
    expect(row("Youssef K.").getByText("Queued")).toBeInTheDocument();
    expect(row("Unknown U.").getByText("Delivery unknown")).toBeInTheDocument();
    expect(
      row("Unknown U.").getByText("Check the Sent folder"),
    ).toBeInTheDocument();
    expect(
      row("Failed F.").getByText("Gmail refused this address"),
    ).toBeInTheDocument();
  });
});
