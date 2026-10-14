import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNothingShown, renderWithProviders } from "@/test/render";
import { OfflineBanner } from "./offline-banner";

const net = vi.hoisted(() => ({ online: false }));
vi.mock("@/hooks/use-online", () => ({ useOnline: () => net.online }));

beforeEach(() => {
  net.online = false;
});

describe("OfflineBanner (spec §7.4)", () => {
  it("says when the shown invites are from, in the viewer's own time", () => {
    const asOf = new Date(2026, 9, 14, 14, 2).toISOString();
    renderWithProviders(<OfflineBanner asOf={asOf} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "You're offline. Showing your invites from 14:02. Answering needs a connection.",
    );
  });

  it("shows nothing online", () => {
    net.online = true;
    renderWithProviders(<OfflineBanner asOf="2026-10-14T13:02:00.000Z" />);
    expectNothingShown();
  });
});
