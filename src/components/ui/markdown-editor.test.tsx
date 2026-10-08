import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { MarkdownEditor } from "./markdown-editor";

function Harness() {
  const [value, setValue] = useState("Hackathon teams");
  return (
    <MarkdownEditor
      id="agenda"
      label="Agenda"
      value={value}
      onChange={setValue}
      maxLength={5000}
    />
  );
}

describe("MarkdownEditor", () => {
  it("bolds the selection and previews safely", async () => {
    renderWithProviders(<Harness />);
    const area = screen.getByRole("textbox", { name: "Agenda" });
    if (area instanceof HTMLTextAreaElement) {
      area.setSelectionRange(0, 9);
    }
    await userEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(area).toHaveValue("**Hackathon** teams");
    await userEvent.click(screen.getByRole("radio", { name: "Preview" }));
    expect(screen.getByText("Hackathon").tagName).toBe("STRONG");
  });
});
