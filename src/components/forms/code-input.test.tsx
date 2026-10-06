import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { CodeInput } from "./code-input";

function Harness({
  onComplete = () => {},
}: {
  onComplete?: (code: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <CodeInput
      id="code"
      label="Sign-in code"
      length={8}
      value={value}
      onChange={setValue}
      onComplete={onComplete}
    />
  );
}

const box = (index: number) => screen.getByLabelText(`Digit ${index} of 8`);

describe("CodeInput", () => {
  it("is a labelled group of 8 numeric boxes, the first one offering code autofill", () => {
    renderWithProviders(<Harness />);
    expect(
      screen.getByRole("group", { name: "Sign-in code" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(8);
    expect(box(1)).toHaveAttribute("autocomplete", "one-time-code");
    expect(box(1)).toHaveAttribute("inputmode", "numeric");
    expect(box(2)).toHaveAttribute("autocomplete", "off");
    expect(box(1).className).toContain("shadow-brutal-sm");
  });

  it("moves to the next box after each digit and ignores letters", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(box(1));
    await user.keyboard("1a2");
    expect(box(1)).toHaveValue("1");
    expect(box(2)).toHaveValue("2");
    expect(box(3)).toHaveFocus();
  });

  it("fills every box from a pasted code with spaces or dashes and completes", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<Harness onComplete={onComplete} />);
    await user.click(box(3));
    await user.paste("1234-5678");
    expect(
      screen
        .getAllByRole("textbox")
        .map((input) => (input as HTMLInputElement).value)
        .join(""),
    ).toBe("12345678");
    expect(onComplete).toHaveBeenCalledWith("12345678");
  });

  it("spreads a whole code that autofill drops into the first box", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<Harness onComplete={onComplete} />);
    await user.type(box(1), "87654321");
    expect(box(8)).toHaveValue("1");
    expect(onComplete).toHaveBeenCalledWith("87654321");
  });

  it("goes back with Backspace on an empty box and moves with the arrows", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(box(1));
    await user.keyboard("12");
    await user.keyboard("{Backspace}");
    expect(box(2)).toHaveValue("");
    expect(box(2)).toHaveFocus();
    await user.keyboard("{Backspace}");
    expect(box(1)).toHaveFocus();
    expect(box(1)).toHaveValue("");
    await user.keyboard("{ArrowRight}");
    expect(box(2)).toHaveFocus();
  });
});
