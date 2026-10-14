import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { myInviteFixture } from "@/test/fixtures/my-invites";
import { renderWithProviders } from "@/test/render";
import { InviteCard } from "./invite-card";

describe("InviteCard", () => {
  it("shows the meeting, its group and time, and what is left to do", () => {
    renderWithProviders(<InviteCard invite={myInviteFixture} tab="upcoming" />);
    expect(screen.getByRole("heading", { name: "Weekly sync" })).toBeVisible();
    expect(screen.getByText("GDG ISSAT · Sun 18 Oct, 18:00")).toBeVisible();
    expect(screen.getByText("Not answered")).toBeVisible();
  });

  it("opens the invite from Upcoming, named after the meeting, its group and time", () => {
    renderWithProviders(<InviteCard invite={myInviteFixture} tab="upcoming" />);
    const link = screen.getByRole("link", {
      name: "Weekly sync GDG ISSAT · Sun 18 Oct, 18:00",
    });
    expect(link).toHaveAccessibleDescription("Not answered");
    expect(link).toHaveAttribute(
      "href",
      `/invites/${myInviteFixture.inviteeId}`,
    );
  });

  it("shows on Past what they said next to the check-in, with their reason, as no link", () => {
    renderWithProviders(
      <InviteCard
        invite={{
          ...myInviteFixture,
          needsAnswer: false,
          answer: {
            status: "late",
            delayMinutes: 10,
            reason: "Bus",
            needsReconfirmation: false,
          },
          mark: { actual: "late", lateMinutes: 15 },
        }}
        tab="past"
      />,
    );
    expect(screen.getByText("Said late by 10 min")).toBeVisible();
    expect(screen.getByText("Was late by 15 min")).toBeVisible();
    expect(screen.getByText("Your reason: Bus")).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps an offline card readable but not openable", () => {
    renderWithProviders(
      <InviteCard invite={myInviteFixture} tab="upcoming" disabled />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Connect to answer")).toBeVisible();
  });
});
