import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNothingShown, renderWithProviders } from "@/test/render";
import { OfflineBanner } from "./offline-banner";

const net = vi.hoisted(() => ({ online: false }));
vi.mock("@/hooks/use-online", () => ({ useOnline: () => net.online }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 14, 16, 0) });
  net.online = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("OfflineBanner (spec §7.4)", () => {
  it("says when the shown invites are from, in the viewer's own time", () => {
    const asOf = new Date(2026, 9, 14, 14, 2).toISOString();
    renderWithProviders(<OfflineBanner asOf={asOf} saved={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "You're offline. Showing your invites from 14:02. Answering needs a connection.",
    );
  });

  it("names the day when the copy isn't from today", () => {
    vi.setSystemTime(new Date(2026, 9, 15, 9, 0));
    const asOf = new Date(2026, 9, 14, 18, 0).toISOString();
    renderWithProviders(<OfflineBanner asOf={asOf} saved={false} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing your invites from Wed 14 Oct, 18:00.",
    );
  });

  it("shows a saved copy even when the browser says it's online (a weak connection)", () => {
    net.online = true;
    const asOf = new Date(2026, 9, 14, 14, 2).toISOString();
    renderWithProviders(<OfflineBanner asOf={asOf} saved />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing your invites from 14:02.",
    );
  });

  it("shows nothing online with a fresh list", () => {
    net.online = true;
    renderWithProviders(
      <OfflineBanner asOf="2026-10-14T13:02:00.000Z" saved={false} />,
    );
    expectNothingShown();
  });
});
