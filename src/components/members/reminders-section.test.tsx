import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceKind } from "@/lib/device/kind";
import type { RemindersState } from "@/lib/push/client";
import { expectNothingShown, renderWithProviders } from "@/test/render";
import { RemindersSection } from "./reminders-section";

const hooks = vi.hoisted(() => ({
  state: "off" as RemindersState | null,
  turnOn: vi.fn<() => void>(),
  turnOff: vi.fn<() => void>(),
  canInstall: false,
}));
vi.mock("@/hooks/use-reminders", () => ({
  useReminders: () => ({
    state: hooks.state,
    turnOn: hooks.turnOn,
    turnOff: hooks.turnOff,
    pending: false,
    justTurnedOn: false,
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
    install: vi.fn(),
    needsHomeScreenGuide: hooks.state === "needs_install",
    standalone: false,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  kind.device = "phone";
  hooks.state = "off";
  hooks.canInstall = false;
});

describe("RemindersSection (spec §7.4, /account)", () => {
  it("switches this phone's reminders on and off", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<RemindersSection />);
    await user.click(
      screen.getByRole("switch", { name: "Reminders on this phone" }),
    );
    expect(hooks.turnOn).toHaveBeenCalledOnce();
    unmount();
    hooks.state = "on";
    renderWithProviders(<RemindersSection />);
    const toggle = screen.getByRole("switch", {
      name: "Reminders on this phone",
    });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(hooks.turnOff).toHaveBeenCalledOnce();
  });

  it("is named for the device it is on", () => {
    kind.device = "computer";
    renderWithProviders(<RemindersSection />);
    expect(
      screen.getByRole("switch", { name: "Reminders on this computer" }),
    ).toBeVisible();
  });

  it("is off and explains why when the phone can't take reminders yet", async () => {
    const user = userEvent.setup();
    for (const [state, text] of [
      ["blocked", "Notifications are blocked"],
      ["unsupported", "This browser can't show reminders."],
      [
        "needs_install",
        "On iPhone, reminders work once TapNShow is on your Home Screen.",
      ],
    ] as const) {
      hooks.state = state;
      const { unmount } = renderWithProviders(<RemindersSection />);
      expect(
        screen.getByRole("switch", { name: "Reminders on this phone" }),
      ).toBeDisabled();
      expect(screen.getByText(text)).toBeVisible();
      if (state === "needs_install") {
        await user.click(screen.getByRole("button", { name: "Show me how" }));
        expect(screen.getByRole("dialog")).toBeVisible();
      }
      unmount();
    }
  });

  it("offers Install when the browser allows it, and hides itself where reminders don't exist", () => {
    hooks.canInstall = true;
    const { unmount } = renderWithProviders(<RemindersSection />);
    expect(
      screen.getByRole("button", { name: "Install the app" }),
    ).toBeVisible();
    unmount();
    hooks.state = "unavailable";
    renderWithProviders(<RemindersSection />);
    expectNothingShown();
  });
});
