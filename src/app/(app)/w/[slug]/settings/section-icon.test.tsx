import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SectionIcon } from "./section-icon";

describe("SectionIcon (colour means state)", () => {
  it.each([
    ["general", "primary"],
    ["defaults", "primary"],
    ["people", "primary"],
    ["danger", "danger"],
  ] as const)("%s → %s tile", (section, tone) => {
    const { container } = render(<SectionIcon section={section} />);
    expect(container.querySelector("[data-tone]")).toHaveAttribute(
      "data-tone",
      tone,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
