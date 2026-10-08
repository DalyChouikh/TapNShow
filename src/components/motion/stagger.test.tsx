import { render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { Stagger, StaggerItem } from "./stagger";

describe("Stagger", () => {
  it("renders children fully visible on the server (no opacity 0 before hydration)", () => {
    const html = renderToString(
      <Stagger>
        <StaggerItem>Meeting card</StaggerItem>
      </Stagger>,
    );
    expect(html).toContain("Meeting card");
    expect(html).not.toMatch(/opacity:\s*0/);
  });

  it("still renders its children on the client", () => {
    render(
      <Stagger>
        <StaggerItem>Choice</StaggerItem>
      </Stagger>,
    );
    // A client-side mount plays the entrance (it starts hidden), so only presence is asserted.
    expect(screen.getByText("Choice")).toBeInTheDocument();
  });

  it("finishes the entrance after a client-side mount (items must not stay hidden)", async () => {
    MotionGlobalConfig.skipAnimations = true;
    render(
      <Stagger>
        <StaggerItem>Loaded later</StaggerItem>
      </Stagger>,
    );
    await waitFor(() =>
      expect(screen.getByText("Loaded later").style.opacity).toBe("1"),
    );
  });
});

afterEach(() => {
  MotionGlobalConfig.skipAnimations = false;
});
