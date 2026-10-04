import { CheckIcon } from "@phosphor-icons/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sticker } from "./sticker";

describe("Sticker", () => {
  it("is decorative by default", () => {
    const { container } = render(
      <Sticker tone="success">
        <CheckIcon weight="bold" />
      </Sticker>,
    );
    const el = container.firstElementChild;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveAttribute("data-tone", "success");
  });

  it("is an accessible image when labelled", () => {
    render(
      <Sticker tone="info" label="Location">
        <CheckIcon weight="bold" />
      </Sticker>,
    );
    expect(screen.getByRole("img", { name: "Location" })).toBeInTheDocument();
  });
});
