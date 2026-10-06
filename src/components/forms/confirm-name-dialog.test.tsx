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
});
