import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { UserMenu } from "./user-menu";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
const clearMock = vi.hoisted(() =>
  vi.fn<() => Promise<void>>(async () => undefined),
);
vi.mock("@/lib/device/clear", () => ({ clearDeviceData: clearMock }));

afterEach(() => vi.unstubAllGlobals());

describe("UserMenu", () => {
  it("signs out through the API, then leaves", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: true })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onSignedOut = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<UserMenu me={meFixture} onSignedOut={onSignedOut} />);
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/signout",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("lists My invites, Account and Sign out", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu me={meFixture} />);
    await user.click(screen.getByRole("button", { name: "Account" }));
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["My invites", "Account", "Sign out"]);
    expect(screen.getByRole("menuitem", { name: "Account" })).toHaveAttribute(
      "href",
      "/account",
    );
  });

  it("clears this device before signing out", async () => {
    const steps: string[] = [];
    clearMock.mockImplementationOnce(async () => {
      steps.push("clear device");
    });
    const fetchMock = vi.fn<typeof fetch>(async () => {
      steps.push("sign out");
      return new Response(JSON.stringify({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSignedOut = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<UserMenu me={meFixture} onSignedOut={onSignedOut} />);
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalledOnce());
    expect(steps).toEqual(["clear device", "sign out"]);
  });

  it("opens the member home from My invites", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu me={meFixture} />);
    await user.click(screen.getByRole("button", { name: "Account" }));
    expect(
      screen.getByRole("menuitem", { name: "My invites" }),
    ).toHaveAttribute("href", "/invites");
  });

  it("has the theme choice between Account and Sign out", async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu me={meFixture} />);
    await user.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
  });
});
