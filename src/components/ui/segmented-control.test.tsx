import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { SegmentedControl } from "./segmented-control";

function Harness() {
  const [value, setValue] = useState("file");
  return (
    <>
      <SegmentedControl
        label="Source"
        value={value}
        onValueChange={setValue}
        options={[
          { value: "file", label: "File" },
          { value: "paste", label: "Paste" },
        ]}
      />
      <output>{value}</output>
    </>
  );
}

describe("SegmentedControl", () => {
  it("switches between options and never ends up empty", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);
    expect(
      screen.getByRole("radiogroup", { name: "Source" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Paste" }));
    expect(screen.getByRole("status")).toHaveTextContent("paste");
    await user.click(screen.getByRole("radio", { name: "Paste" }));
    expect(screen.getByRole("status")).toHaveTextContent("paste");
    expect(screen.getByRole("radio", { name: "Paste" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
