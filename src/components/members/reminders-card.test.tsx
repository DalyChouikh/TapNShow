import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEVICE_KEYS } from "@/config/members";
import type { DeviceKind } from "@/lib/device/kind";
import type { RemindersState } from "@/lib/push/client";
import { expectNothingShown, renderWithProviders } from "@/test/render";
import { RemindersCard } from "./reminders-card";

const hooks = vi.hoisted(() => ({
  state: "off" as RemindersState | null,
  justTurnedOn: false,
  turnOn: vi.fn<() => void>(),
  canInstall: false,
  install: vi.fn<() => Promise<void>>(async () => undefined),
}));
vi.mock("@/hooks/use-reminders", () => ({
  useReminders: () => ({
    state: hooks.state,
    turnOn: hooks.turnOn,
    turnOff: vi.fn(),
    pending: false,
    justTurnedOn: hooks.justTurnedOn,
  }),
}));
const kind = vi.hoisted(() => ({ device: "phone" as DeviceKind }));
vi.mock("@/lib/device/kind", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/device/kind")>()),
  useDeviceKind: () => kind.device,
}));
vi.mock("@/hooks/use-install-prompt", () => ({
  useInstallPrompt: () => ({
    canInstall: hooks.canInstall,
    install: hooks.install,
    needsHomeScreenGuide: hooks.state === "needs_install",
    standalone: false,
  }),
}));

const DAY = 86_400_000;

beforeEach(() => {
  vi.clearAllMocks();
  kind.device = "phone";
  window.localStorage.clear();
  hooks.state = "off";
  hooks.justTurnedOn = false;
  hooks.canInstall = false;
});

describe("RemindersCard (spec §7.4)", () => {
  it("offers Turn on, and Install only when the browser allows it", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<RemindersCard />);
    expect(screen.getByText("Get reminders on this phone")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Install the app" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Turn on" }));
    expect(hooks.turnOn).toHaveBeenCalledOnce();
    unmount();
    hooks.canInstall = true;
    renderWithProviders(<RemindersCard />);
    await user.click(screen.getByRole("button", { name: "Install the app" }));
    expect(hooks.install).toHaveBeenCalledOnce();
  });

  it("Not now hides it on this device for 30 days", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RemindersCard />);
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Get reminders on this phone")).toBeNull();
    const until = Date.parse(
      window.localStorage.getItem(DEVICE_KEYS.remindersHiddenUntil) ?? "",
    );
    expect(until - Date.now()).toBeGreaterThan(29 * DAY);
    expect(until - Date.now()).toBeLessThanOrEqual(30 * DAY);
  });

  it("stays hidden while a saved Not now lasts", () => {
    window.localStorage.setItem(
      DEVICE_KEYS.remindersHiddenUntil,
      new Date(Date.now() + DAY).toISOString(),
    );
    renderWithProviders(<RemindersCard />);
    expect(screen.queryByText("Get reminders on this phone")).toBeNull();
  });

  it("walks an iPhone through the Home Screen steps", async () => {
    hooks.state = "needs_install";
    kind.device = "iphone";
    const user = userEvent.setup();
    renderWithProviders(<RemindersCard />);
    expect(screen.getByText("Get reminders on this iPhone")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Show me how" }));
    expect(
      screen.getByRole("dialog", { name: "Add TapNShow to your Home Screen" }),
    ).toBeVisible();
    // Any iPhone browser can add to the Home Screen (iOS 16.4+): no browser named.
    expect(
      screen.getByText(
        "Tap Share in your browser. In some browsers, Share is inside the menu.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Safari/)).toBeNull();
  });

  it("names the device it is on: a computer, an iPad", async () => {
    kind.device = "computer";
    const { unmount } = renderWithProviders(<RemindersCard />);
    expect(screen.getByText("Get reminders on this computer")).toBeVisible();
    unmount();
    hooks.state = "needs_install";
    kind.device = "ipad";
    const user = userEvent.setup();
    renderWithProviders(<RemindersCard />);
    expect(screen.getByText("Get reminders on this iPad")).toBeVisible();
    expect(
      screen.getByText(
        "On iPad, reminders work once TapNShow is on your Home Screen.",
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Show me how" }));
    expect(
      screen.getByText(
        "Tap Share in your browser. In some browsers, Share is inside the menu.",
      ),
    ).toBeVisible();
  });

  it("explains a block, and Hide hides it", async () => {
    hooks.state = "blocked";
    const user = userEvent.setup();
    renderWithProviders(<RemindersCard />);
    expect(screen.getByText("Notifications are blocked")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText("Notifications are blocked")).toBeNull();
  });

  it("says once that reminders are on, then disappears", () => {
    hooks.state = "on";
    hooks.justTurnedOn = true;
    const { unmount } = renderWithProviders(<RemindersCard />);
    expect(screen.getByText("Reminders are on for this phone")).toBeVisible();
    unmount();
    hooks.justTurnedOn = false;
    renderWithProviders(<RemindersCard />);
    expectNothingShown();
  });

  it.each<RemindersState | null>([null, "unavailable", "unsupported", "on"])(
    "shows nothing when %s",
    (state) => {
      hooks.state = state;
      renderWithProviders(<RemindersCard />);
      expectNothingShown();
    },
  );
});
