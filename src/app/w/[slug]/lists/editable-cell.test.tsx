import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { EditableCell } from "./editable-cell";

const notEmpty = (value: string) => (value.trim() ? null : "Required");

function renderCells(onCommit = vi.fn()) {
  renderWithProviders(
    <table>
      <tbody>
        <tr>
          <td>
            <EditableCell
              value="Inès"
              label="Full name of Inès"
              onCommit={onCommit}
              validate={notEmpty}
              rowIndex={0}
              columnIndex={1}
            />
          </td>
          <td>
            <EditableCell
              value="ines@example.com"
              label="Email of Inès"
              onCommit={vi.fn()}
              validate={notEmpty}
              rowIndex={0}
              columnIndex={2}
            />
          </td>
        </tr>
        <tr>
          <td>
            <EditableCell
              value="Sarra"
              label="Full name of Sarra"
              onCommit={vi.fn()}
              validate={notEmpty}
              rowIndex={1}
              columnIndex={1}
            />
          </td>
          <td />
        </tr>
      </tbody>
    </table>,
  );
  return onCommit;
}

describe("EditableCell", () => {
  it("edits with Enter, commits on Enter, cancels with Escape", async () => {
    const user = userEvent.setup();
    const onCommit = renderCells();
    await user.click(screen.getByRole("button", { name: "Full name of Inès" }));
    const field = screen.getByRole("textbox", { name: "Full name of Inès" });
    await user.clear(field);
    await user.type(field, "Inès B.{Enter}");
    expect(onCommit).toHaveBeenCalledWith("Inès B.");

    await user.click(screen.getByRole("button", { name: "Full name of Inès" }));
    await user.type(
      screen.getByRole("textbox", { name: "Full name of Inès" }),
      "xx{Escape}",
    );
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("does not commit invalid or unchanged values", async () => {
    const user = userEvent.setup();
    const onCommit = renderCells();
    await user.click(screen.getByRole("button", { name: "Full name of Inès" }));
    await user.clear(
      screen.getByRole("textbox", { name: "Full name of Inès" }),
    );
    await user.tab();
    expect(screen.getByText("Required")).toBeInTheDocument();
    await user.click(
      screen.getByRole("textbox", { name: "Full name of Inès" }),
    );
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Full name of Inès" }));
    await user.tab();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("returns focus to the cell after Enter or Escape", async () => {
    const user = userEvent.setup();
    renderCells();
    await user.click(screen.getByRole("button", { name: "Full name of Inès" }));
    await user.type(
      screen.getByRole("textbox", { name: "Full name of Inès" }),
      "!{Enter}",
    );
    expect(
      screen.getByRole("button", { name: "Full name of Inès" }),
    ).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("button", { name: "Full name of Inès" }),
    ).toHaveFocus();
  });

  it("moves between cells with the arrow keys", async () => {
    const user = userEvent.setup();
    renderCells();
    screen.getByRole("button", { name: "Full name of Inès" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Email of Inès" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowDown}");
    expect(
      screen.getByRole("button", { name: "Full name of Sarra" }),
    ).toHaveFocus();
  });
});
