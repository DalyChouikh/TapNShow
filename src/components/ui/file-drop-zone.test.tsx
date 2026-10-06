import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { FileDropZone } from "./file-drop-zone";

describe("FileDropZone", () => {
  it("hands over a chosen file and a dropped file", async () => {
    const onFile = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <FileDropZone
        id="roster-file"
        title="Choose a .csv or .xlsx"
        hint="Up to 5 MB"
        accept=".csv,.xlsx"
        onFile={onFile}
      />,
    );
    const input = screen.getByLabelText("Choose a .csv or .xlsx");
    expect(input).toHaveAttribute("type", "file");
    expect(input.className).toContain("opacity-0");
    expect(input.className).toContain("inset-0");
    const chosen = new File(["Email\n"], "roster.csv", { type: "text/csv" });
    await user.upload(input, chosen);
    expect(onFile).toHaveBeenLastCalledWith(chosen);

    const dropped = new File(["x"], "team.xlsx");
    fireEvent.drop(screen.getByTestId("roster-file-zone"), {
      dataTransfer: { files: [dropped] },
    });
    expect(onFile).toHaveBeenLastCalledWith(dropped);
  });
});
