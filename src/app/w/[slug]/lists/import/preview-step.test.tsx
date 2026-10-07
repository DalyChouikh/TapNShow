import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importPreviewFixture, rosterFixture } from "@/test/fixtures/roster";
import { renderWithProviders } from "@/test/render";
import { PreviewStep } from "./preview-step";

// jsdom lays nothing out (offsetHeight is 0), so the virtualized row list would render nothing.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("PreviewStep", () => {
  it("summarizes the dry run and filters rows by tile", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PreviewStep
        result={importPreviewFixture}
        limits={rosterFixture.limits}
      />,
    );
    expect(screen.getByRole("button", { name: "1 New" })).toBeInTheDocument();
    expect(screen.getByText("New lists:")).toBeInTheDocument();
    expect(screen.getByText("Events")).toBeInTheDocument();
    expect(
      screen.getByText('"mehdi.g@gmail" is not an email address'),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Youssef Trabelsi → Youssef T."),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "1 Invalid, skipped" }),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Show all rows" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("warns when the import would pass a limit", () => {
    renderWithProviders(
      <PreviewStep
        result={{ ...importPreviewFixture, limitExceeded: "contacts" }}
        limits={rosterFixture.limits}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This import would go past your roster limit of 2000 people.",
    );
  });

  it("lists one line per merged row under Merged duplicates, matching the tile", async () => {
    const user = userEvent.setup();
    const [first, ...rest] = importPreviewFixture.rows.filter(
      (row) => row.outcome !== "invalid",
    );
    const result = {
      ...importPreviewFixture,
      summary: { ...importPreviewFixture.summary, merged: 2 },
      rows: [
        { ...first, row: 3, mergedRows: [5, 7] },
        ...rest.map((row) => ({ ...row, mergedRows: [] })),
      ],
    };
    renderWithProviders(
      <PreviewStep result={result} limits={rosterFixture.limits} />,
    );
    await user.click(
      screen.getByRole("button", { name: "2 Merged duplicates" }),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(
      screen.getByText(`Row 5 merged into row 3 (${first.email})`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Row 7 merged into row 3 (${first.email})`),
    ).toBeInTheDocument();
  });
});
