import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { guessColumns } from "@/lib/import/guess-columns";
import { parsePaste } from "@/lib/import/parse-delimited";
import type { ColumnMapping } from "@/lib/import/types";
import { rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { MatchStep } from "./match-step";

const grid = parsePaste(
  "Prénom\tNom\tE-mail\tÉquipe\tPhone\nInès\tBen Salah\tines@example.com\tDev\t+216",
);

function Harness({ rowLimit = 2000 }) {
  const [mapping, setMapping] = useState<ColumnMapping>(guessColumns(grid));
  const [alsoAdd, setAlsoAdd] = useState<string | null>(null);
  return (
    <MatchStep
      grid={grid}
      mapping={mapping}
      onMappingChange={setMapping}
      rowCount={1}
      rowLimit={rowLimit}
      lists={rosterFixture.lists}
      alsoAddToListId={alsoAdd}
      onAlsoAddChange={setAlsoAdd}
    />
  );
}

describe("MatchStep", () => {
  it("shows each column with a sample and its guessed target (Review Focus 3)", () => {
    renderWithProviders(<Harness />);
    expect(
      screen.getByRole("combobox", { name: "What is Prénom?" }),
    ).toHaveTextContent("Full name");
    expect(
      screen.getByRole("combobox", { name: "What is Nom?" }),
    ).toHaveTextContent("Full name");
    expect(
      screen.getByRole("combobox", { name: "What is E-mail?" }),
    ).toHaveTextContent("Email");
    expect(
      screen.getByRole("combobox", { name: "What is Équipe?" }),
    ).toHaveTextContent("Lists");
    expect(
      screen.getByRole("combobox", { name: "What is Phone?" }),
    ).toHaveTextContent("Ignore");
    expect(screen.getByText("ines@example.com")).toBeInTheDocument();
  });

  it("explains a missing Email column", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(screen.getByRole("combobox", { name: "What is E-mail?" }));
    await user.click(screen.getByRole("option", { name: "Ignore" }));
    expect(screen.getByText("Match one column to Email.")).toBeInTheDocument();
  });

  it("explains a sheet over the row limit", () => {
    renderWithProviders(<Harness rowLimit={0} />);
    expect(screen.getByText(/more than the 0 allowed/)).toBeInTheDocument();
  });

  it("renames headers to 'Column N' when the first row is data", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    await user.click(
      screen.getByRole("switch", { name: "First row is headers" }),
    );
    expect(
      screen.getByRole("combobox", { name: "What is Column 1?" }),
    ).toBeInTheDocument();
  });
});
