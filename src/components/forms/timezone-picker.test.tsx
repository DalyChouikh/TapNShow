import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { TimezonePicker } from "./timezone-picker";

describe("TimezonePicker", () => {
  it("is labelled, searchable, and reports the chosen zone", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <TimezonePicker
        id="tz"
        label="Timezone"
        value="Europe/Paris"
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Timezone" });
    expect(trigger).toHaveTextContent("Europe/Paris");
    await user.click(trigger);
    await user.type(screen.getByPlaceholderText("Search timezones"), "Tunis");
    await user.click(screen.getByRole("option", { name: "Africa/Tunis" }));
    expect(onChange).toHaveBeenCalledWith("Africa/Tunis");
  });
});
