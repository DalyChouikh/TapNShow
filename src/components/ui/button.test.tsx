import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders a button with its tone and size", () => {
    render(
      <Button tone="warning" size="lg">
        I&apos;ll be late
      </Button>,
    );
    const button = screen.getByRole("button", { name: "I'll be late" });
    expect(button).toHaveAttribute("data-tone", "warning");
    expect(button).toHaveAttribute("data-size", "lg");
    expect(button).toHaveAttribute("type", "button");
  });

  it("defaults to the surface tone and md size", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("data-tone", "surface");
    expect(screen.getByRole("button")).toHaveAttribute("data-size", "md");
  });

  it("calls onClick and ignores clicks when disabled", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders its child element when asChild is set", () => {
    render(
      <Button asChild tone="primary">
        <a href="/w/demo">Open</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "data-tone",
      "primary",
    );
  });
});
