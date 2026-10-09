import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { ExportMenu } from "./export-menu";

describe("ExportMenu", () => {
  it("offers CSV and Excel and calls the export with the format", async () => {
    let finish: () => void = () => undefined;
    const onExport = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const user = userEvent.setup();
    renderWithProviders(<ExportMenu onExport={onExport} />);
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("menuitem", { name: "CSV" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Excel (.xlsx)" }));
    expect(onExport).toHaveBeenCalledWith("xlsx");
    expect(screen.getByRole("button", { name: "Preparing…" })).toBeDisabled();
    finish();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Export" })).toBeEnabled(),
    );
  });

  it("says so when the export fails", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ExportMenu onExport={() => Promise.reject(new Error("offline"))} />,
      { toaster: true },
    );
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "CSV" }));
    expect(
      await screen.findByText("Couldn't export. Try again."),
    ).toBeInTheDocument();
  });
});
