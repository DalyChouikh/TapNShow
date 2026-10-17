import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DayRange } from "@/lib/date-range";
import { renderWithProviders } from "@/test/render";
import { DateRangeFields } from "./date-range-fields";

describe("DateRangeFields", () => {
  it("carries To along when From moves past it", async () => {
    const onChange = vi.fn<(range: DayRange) => void>();
    const user = userEvent.setup();
    renderWithProviders(
      <DateRangeFields
        id="range"
        value={{ from: "2026-09-01", to: "2026-09-10" }}
        onChange={onChange}
        today="2026-10-08"
      />,
    );
    await user.click(screen.getByRole("button", { name: /^From / }));
    await user.click(
      screen.getByRole("button", { name: /September 20th, 2026/ }),
    );
    expect(onChange).toHaveBeenCalledWith({
      from: "2026-09-20",
      to: "2026-09-20",
    });
  });

  it("offers no day past the latest or beyond the longest range", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DateRangeFields
        id="range"
        value={{ from: "2026-10-01", to: "2026-10-05" }}
        onChange={vi.fn<(range: DayRange) => void>()}
        today="2026-10-16"
        bounds={{ latest: "2026-10-16", maxDays: 10 }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^To / }));
    expect(
      screen.getByRole("button", { name: /October 10th, 2026/ }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /October 11th, 2026/ }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /^From / }));
    expect(
      screen.getByRole("button", { name: /October 17th, 2026/ }),
    ).toBeDisabled();
  });
});
