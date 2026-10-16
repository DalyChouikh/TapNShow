import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLATFORM_ADMIN_ID,
  PLATFORM_OWNER_ID,
  adminsFixture,
} from "@/test/fixtures/admin";
import { json, routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { AdminList } from "./admin-list";

afterEach(() => vi.unstubAllGlobals());

describe("AdminList", () => {
  it("lists the owner first, marks the viewer, and lets the owner remove an admin after confirming", async () => {
    const fetchMock = routeFetch({
      [`DELETE /api/admin/admins/${PLATFORM_ADMIN_ID}`]: json({ ok: true }),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <AdminList admins={adminsFixture.admins} viewerId={PLATFORM_OWNER_ID} />,
      { toaster: true },
    );
    const [owner, admin] = screen.getAllByRole("listitem");
    expect(owner).toHaveTextContent("Amira Ben Ali");
    expect(owner).toHaveTextContent("You");
    expect(owner).toHaveTextContent("Platform owner");
    expect(owner).toHaveTextContent("Set at setup · can't be removed");
    expect(within(owner).queryByRole("button")).toBeNull();
    expect(admin).toHaveTextContent("s•••@example.test · since 3 Oct 2026");
    await user.click(
      within(admin).getByRole("button", { name: "Actions for Sami" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Remove" }));
    const dialog = screen.getByRole("dialog", {
      name: "Remove Sami as an admin?",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(
      await screen.findByText("Sami is no longer an admin"),
    ).toBeInTheDocument();
  });

  it("gives an admin who isn't the owner no actions", () => {
    renderWithProviders(
      <AdminList admins={adminsFixture.admins} viewerId={PLATFORM_ADMIN_ID} />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("You");
  });

  it("names an admin without a display name by the address, once", () => {
    renderWithProviders(
      <AdminList
        admins={[{ ...adminsFixture.admins[0], name: null }]}
        viewerId={PLATFORM_OWNER_ID}
      />,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent(
      /^s•••@example\.testAdminsince 3 Oct 2026$/,
    );
  });
});
