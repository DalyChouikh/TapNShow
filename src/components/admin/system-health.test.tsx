import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { overviewFixture } from "@/test/fixtures/admin";
import { renderWithProviders } from "@/test/render";
import { SystemHealth } from "./system-health";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("SystemHealth", () => {
  it("shows the queue, the sheets and the senders to reconnect", () => {
    renderWithProviders(
      <SystemHealth
        health={overviewFixture.health}
        pushes={overviewFixture.current}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "System health" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("12 waiting · oldest queued 2 minutes ago"),
    ).toBeInTheDocument();
    expect(screen.getByText("2 paused of 19")).toBeInTheDocument();
    expect(
      screen.getByText("Senders needing reconnect").nextSibling,
    ).toHaveTextContent("3");
    expect(
      screen.getByText("Phone notifications").nextSibling,
    ).toHaveTextContent("99.1% delivered");
  });

  it("says when nothing is waiting or was sent", () => {
    renderWithProviders(
      <SystemHealth
        health={{
          ...overviewFixture.health,
          queueWaiting: 0,
          queueOldest: null,
        }}
        pushes={{ pushesSent: 0, pushesFailed: 0 }}
      />,
    );
    expect(screen.getByText("Nothing waiting")).toBeInTheDocument();
    expect(
      screen.getByText("Phone notifications").nextSibling,
    ).toHaveTextContent("none sent");
  });
});
