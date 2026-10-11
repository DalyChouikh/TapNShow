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

  it("adds Open the Google Sheet as a link that opens a new tab", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ExportMenu
        onExport={vi.fn()}
        sheet={{
          href: "https://docs.google.com/spreadsheets/d/x/edit#gid=12",
          paused: false,
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByRole("separator")).toBeInTheDocument();
    const item = screen.getByRole("menuitem", {
      name: "Open the Google Sheet",
    });
    expect(item).toHaveAttribute(
      "href",
      "https://docs.google.com/spreadsheets/d/x/edit#gid=12",
    );
    expect(item).toHaveAttribute("target", "_blank");
    expect(item).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("says the sheet is paused, linking the Owner to Settings and disabled for others", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(
      <ExportMenu
        onExport={vi.fn()}
        sheet={{
          href: null,
          paused: true,
          settingsHref: "/w/x/settings#sheets",
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(
      screen.getByRole("menuitem", { name: "The Google Sheet is paused" }),
    ).toHaveAttribute("href", "/w/x/settings#sheets");
    unmount();
    renderWithProviders(
      <ExportMenu onExport={vi.fn()} sheet={{ href: null, paused: true }} />,
    );
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(
      screen.getByRole("menuitem", { name: "The Google Sheet is paused" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("is unchanged without a sheet", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExportMenu onExport={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });
});
