import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { ContactCard } from "./contact-card";

const ines = rosterFixture.contacts[0];

describe("ContactCard", () => {
  it("keeps the email readable on the selected (filled) card", () => {
    renderWithProviders(
      <ContactCard
        contact={ines}
        lists={rosterFixture.lists}
        onOpen={vi.fn()}
        selection={{ selected: true, onToggle: vi.fn() }}
      />,
    );
    expect(screen.getByText(ines.email)).toHaveClass("text-on-fill");
    expect(screen.getByText(ines.email)).not.toHaveClass("text-muted-ink");
  });

  it("uses the muted email color on the plain card", () => {
    renderWithProviders(
      <ContactCard
        contact={ines}
        lists={rosterFixture.lists}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText(ines.email)).toHaveClass("text-muted-ink");
  });

  it("marks people who unsubscribed or reported the group", () => {
    const { unmount } = renderWithProviders(
      <ContactCard
        contact={{ ...ines, unsubscribed: true }}
        lists={rosterFixture.lists}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("Unsubscribed")).toBeInTheDocument();
    unmount();
    renderWithProviders(
      <ContactCard
        contact={{ ...ines, unsubscribed: true, reported: true }}
        lists={rosterFixture.lists}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("Reported: not my group")).toBeInTheDocument();
    expect(screen.queryByText("Unsubscribed")).toBeNull();
  });
});
