import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { UserMenu } from "./user-menu";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

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

  it("edits the display name in a dialog", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: true })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<UserMenu me={meFixture} />);
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.click(screen.getByRole("menuitem", { name: "Your name" }));
    const field = within(
      screen.getByRole("dialog", { name: "Your name" }),
    ).getByLabelText("Name");
    await user.clear(field);
    await user.type(field, "Amira B.");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
        displayName: "Amira B.",
      }),
    );
  });
});
