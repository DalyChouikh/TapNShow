import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { ImportSheet } from "@/lib/import/types";
import { makeXlsx } from "@/test/fixtures/xlsx";
import { renderWithProviders } from "@/test/render";
import { SourceStep } from "./source-step";

function Harness({ initial = "file" as "file" | "paste" }) {
  const [source, setSource] = useState(initial);
  const [sheets, setSheets] = useState<ImportSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [pasteText, setPasteText] = useState("");
  return (
    <>
      <SourceStep
        source={source}
        onSourceChange={setSource}
        sheets={sheets}
        sheetIndex={sheetIndex}
        onSheets={setSheets}
        onSheetIndex={setSheetIndex}
        pasteText={pasteText}
        onPasteText={setPasteText}
      />
      <output>{sheets.map((s) => s.name).join("|")}</output>
    </>
  );
}

describe("SourceStep", () => {
  it("reads a multi-sheet workbook on the device and offers a sheet choice", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    const workbook = makeXlsx([
      {
        name: "Members 2026",
        rows: [["Email"], ["a@example.com"], ["b@example.com"]],
      },
      { name: "Alumni", rows: [["Email"], ["c@example.com"]] },
    ]);
    await user.upload(
      screen.getByLabelText("Choose a .csv or .xlsx"),
      new File([workbook], "club.xlsx"),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Members 2026|Alumni",
    );
    expect(screen.getByRole("combobox", { name: "Sheet" })).toHaveTextContent(
      "Members 2026",
    );
    expect(screen.getByText("club.xlsx: 3 rows")).toBeInTheDocument();
  });

  it("explains files it cannot read", async () => {
    // A file picker's `accept` is only a hint: people can still choose "All files".
    const user = userEvent.setup({ applyAccept: false });
    renderWithProviders(<Harness />);
    await user.upload(
      screen.getByLabelText("Choose a .csv or .xlsx"),
      new File(["x"], "old.xls"),
    );
    expect(
      await screen.findByText(
        "Old .xls files can't be read. Save it as .xlsx or CSV and try again.",
      ),
    ).toBeInTheDocument();
  });

  it("switches to a paste box", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(screen.getByRole("radio", { name: "Paste" }));
    expect(screen.getByLabelText("Paste rows").tagName).toBe("TEXTAREA");
  });
});
