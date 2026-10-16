import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLATFORM_ADMIN_ID, adminsFixture } from "@/test/fixtures/admin";
import { meFixture } from "@/test/fixtures/me";
import { json, routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { AdminAdminsView } from "./admin-admins";

afterEach(() => vi.unstubAllGlobals());

describe("AdminAdminsView", () => {
  it("gives the platform owner the invites and Add an admin", async () => {
    routeFetch({
      "GET /api/me": json({ ...meFixture, platformRole: "owner" }),
      "GET /api/admin/admins": json(adminsFixture),
    });
    renderWithProviders(<AdminAdminsView />);
    expect(
      await screen.findByRole("heading", { name: "Invites waiting" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add an admin" }),
    ).toBeInTheDocument();
  });

  it("shows an admin the list only", async () => {
    routeFetch({
      "GET /api/me": json({
        ...meFixture,
        userId: PLATFORM_ADMIN_ID,
        platformRole: "admin",
      }),
      "GET /api/admin/admins": json(adminsFixture),
    });
    renderWithProviders(<AdminAdminsView />);
    expect(await screen.findByText("Platform owner")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Invites waiting" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Add an admin" })).toBeNull();
  });
});
