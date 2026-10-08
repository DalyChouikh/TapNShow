import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { ConfirmDialog } from "./confirm-dialog";

describe("ConfirmDialog", () => {
  it("names the consequence and confirms once", async () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Send 30 invites from club@gmail.com now?"
        confirmLabel="Send 30 invites"
        onConfirm={onConfirm}
      />,
    );
    expect(
      screen.getByRole("dialog", {
        name: "Send 30 invites from club@gmail.com now?",
      }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Send 30 invites" }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables the action while pending and cancels without confirming", async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    renderWithProviders(
      <ConfirmDialog
        open
        pending
        onOpenChange={onOpenChange}
        title="Disconnect?"
        confirmLabel="Disconnect"
        tone="danger"
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
