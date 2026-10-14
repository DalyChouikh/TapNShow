import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { meFixture } from "@/test/fixtures/me";
import { renderWithProviders } from "@/test/render";
import { MemberShell } from "./member-shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

describe("MemberShell", () => {
  it("links the logo home and offers the way back to a workspace", async () => {
    routeFetch({ "GET /api/me": json(meFixture) });
    renderWithProviders(<MemberShell>page</MemberShell>);
    expect(
      await screen.findByRole("link", { name: "Your workspaces" }),
    ).toHaveAttribute("href", "/w/robotics-cd34");
    expect(screen.getByRole("link", { name: "TapNShow" })).toHaveAttribute(
      "href",
      "/invites",
    );
    expect(screen.getByRole("button", { name: "Account" })).toBeVisible();
    expect(screen.getByText("page")).toBeVisible();
  });

  it("has no workspace link for a member without one", async () => {
    routeFetch({
      "GET /api/me": json({
        ...meFixture,
        workspaces: [],
        lastWorkspaceSlug: null,
      }),
    });
    renderWithProviders(<MemberShell>page</MemberShell>);
    expect(await screen.findByText("page")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Your workspaces" })).toBeNull();
  });
});
