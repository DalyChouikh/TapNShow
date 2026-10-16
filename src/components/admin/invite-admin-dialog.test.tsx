import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, routeFetch } from "@/test/fetch";
import { renderWithProviders } from "@/test/render";
import { InviteAdminButton } from "./invite-admin-dialog";

afterEach(() => vi.unstubAllGlobals());

async function openDialog() {
  const user = userEvent.setup();
  renderWithProviders(<InviteAdminButton />, { toaster: true });
  await user.click(screen.getByRole("button", { name: "Add an admin" }));
  return user;
}

describe("InviteAdminButton", () => {
  it("emails an invite once the address is valid", async () => {
    const fetchMock = routeFetch({
      "POST /api/admin/invites": json({ status: "sent" }),
    });
    const user = await openDialog();
    expect(
      screen.getByText(
        "They can see this dashboard, handle reports and suspend or lift sending. They can't add admins.",
      ),
    ).toBeInTheDocument();
    const send = screen.getByRole("button", { name: "Send invite" });
    await user.type(screen.getByLabelText("Their email"), "lina@example");
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("Their email"), ".com");
    await user.click(send);
    expect(
      await screen.findByText("Invite sent to l•••@example.com"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
        email: "lina@example.com",
        delivery: "email",
      }),
    );
  });

  it("makes a link to copy", async () => {
    routeFetch({
      "POST /api/admin/invites": json({
        status: "link",
        link: "https://app.test/admin/join/abc",
      }),
    });
    const user = await openDialog();
    await user.type(screen.getByLabelText("Their email"), "lina@example.com");
    await user.click(screen.getByRole("radio", { name: "Copy a link" }));
    await user.click(screen.getByRole("button", { name: "Make the link" }));
    expect(await screen.findByLabelText("Invite link")).toHaveValue(
      "https://app.test/admin/join/abc",
    );
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await navigator.clipboard.readText()).toBe(
      "https://app.test/admin/join/abc",
    );
    expect(await screen.findByText("Invite link copied")).toBeInTheDocument();
  });

  it("says what to do when the email can't go out today", async () => {
    routeFetch({
      "POST /api/admin/invites": json({ status: "email_limit" }),
    });
    const user = await openDialog();
    await user.type(screen.getByLabelText("Their email"), "lina@example.com");
    await user.click(screen.getByRole("button", { name: "Send invite" }));
    expect(
      await screen.findByText(
        "TapNShow sent all its emails for today. Use Copy link on the waiting invite instead.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a refusal in plain words and keeps the form", async () => {
    routeFetch({
      "POST /api/admin/invites": json({ error: { code: "rate_limited" } }, 429),
    });
    const user = await openDialog();
    await user.type(screen.getByLabelText("Their email"), "lina@example.com");
    await user.click(screen.getByRole("button", { name: "Send invite" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Too many/);
    expect(screen.getByLabelText("Their email")).toHaveValue(
      "lina@example.com",
    );
  });
});
