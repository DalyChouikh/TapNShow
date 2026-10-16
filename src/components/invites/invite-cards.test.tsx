import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { InviteClosedCard, InviteWrongAccountCard } from "./invite-cards";

describe("invite cards", () => {
  it("names the invited address and switches account", async () => {
    const onSwitch = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <InviteWrongAccountCard
        email="a•••@gmail.com"
        pending={false}
        onSwitch={onSwitch}
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: "This invite is for a•••@gmail.com",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch account" }));
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it("holds the switch while it is under way", () => {
    renderWithProviders(
      <InviteWrongAccountCard
        email="a•••@gmail.com"
        pending
        onSwitch={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Switch account" }),
    ).toBeDisabled();
  });

  it("says why an invite can't be used", () => {
    renderWithProviders(<InviteClosedCard status="revoked" />);
    expect(screen.getByText("This invite was cancelled.")).toBeInTheDocument();
  });
});
