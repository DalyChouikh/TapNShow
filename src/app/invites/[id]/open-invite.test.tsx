import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { OpenInvite } from "./open-invite";

const mocks = vi.hoisted(() => ({
  replaceWith: vi.fn<(href: string) => void>(),
}));
vi.mock("@/lib/navigation", () => ({ replaceWith: mocks.replaceWith }));

const ID = "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa";
const LINK = `GET /api/me/invites/${ID}/link`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("OpenInvite", () => {
  it("replaces itself with the answer page, so Back returns to the list", async () => {
    const path = `/r/${"a".repeat(43)}`;
    routeFetch({ [LINK]: json({ path }) });
    renderWithProviders(<OpenInvite id={ID} />);
    expect(screen.getByText("Opening your invite…")).toBeVisible();
    await waitFor(() => expect(mocks.replaceWith).toHaveBeenCalledWith(path));
  });

  it("says plainly when the invite isn't the person's or is gone", async () => {
    routeFetch({
      [LINK]: json({ error: { code: "not_found", message: "x" } }, 404),
    });
    renderWithProviders(<OpenInvite id={ID} />);
    expect(
      await screen.findByText("This invite isn't available any more."),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Back to my invites" }),
    ).toHaveAttribute("href", "/invites");
    expect(mocks.replaceWith).not.toHaveBeenCalled();
  });

  it("shows the plain error for anything else", async () => {
    routeFetch({
      [LINK]: json({ error: { code: "rate_limited", message: "x" } }, 429),
    });
    renderWithProviders(<OpenInvite id={ID} />);
    expect(
      await screen.findByRole("link", { name: "Back to my invites" }),
    ).toBeVisible();
    expect(
      screen.queryByText("This invite isn't available any more."),
    ).toBeNull();
  });
});
