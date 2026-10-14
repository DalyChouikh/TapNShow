import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { ConfirmNameDialog } from "./confirm-name-dialog";

describe("ConfirmNameDialog", () => {
  it("enables Confirm only for the exact (trimmed) name", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ConfirmNameDialog
        open
        onOpenChange={() => {}}
        title="Delete workspace"
        body="Gone forever."
        name="Robotics Club"
        confirmLabel="Confirm"
        onConfirm={onConfirm}
      />,
    );
    const confirm = screen.getByRole("button", { name: "Confirm" });
    const field = screen.getByLabelText("Type Robotics Club to confirm");
    await user.type(field, "robotics club");
    expect(confirm).toBeDisabled();
    await user.clear(field);
    await user.type(field, "  Robotics Club ");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith("Robotics Club");
  });

  it("shows the word with a copy button that copies it", async () => {
    // user-event installs its own clipboard on setup: watch that one.
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderWithProviders(
      <ConfirmNameDialog
        open
        onOpenChange={() => {}}
        title="Delete your account?"
        body="Erased."
        name="confirm"
        inputLabel="Type confirm to delete"
        confirmLabel="Delete my account"
        onConfirm={vi.fn()}
      />,
      { toaster: true },
    );
    await user.click(screen.getByRole("button", { name: "Copy confirm" }));
    expect(writeText).toHaveBeenCalledWith("confirm");
    expect(await screen.findByText("Copied")).toBeVisible();
    expect(screen.getByLabelText("Type confirm to delete")).toBeVisible();
  });

  it("asks to type the word when copying is refused", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(
      new Error("denied"),
    );
    renderWithProviders(
      <ConfirmNameDialog
        open
        onOpenChange={() => {}}
        title="Delete workspace"
        body="Gone forever."
        name="Robotics Club"
        confirmLabel="Confirm"
        onConfirm={vi.fn()}
      />,
      { toaster: true },
    );
    await user.click(
      screen.getByRole("button", { name: "Copy Robotics Club" }),
    );
    expect(
      await screen.findByText("Couldn't copy. Type it instead."),
    ).toBeVisible();
  });
});
