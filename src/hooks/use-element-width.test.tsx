import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useElementWidth } from "./use-element-width";

function Probe() {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  return <div ref={ref}>{width === null ? "unknown" : String(width)}</div>;
}

afterEach(() => vi.unstubAllGlobals());

describe("useElementWidth", () => {
  it("is unknown where the browser can't measure (no ResizeObserver)", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<Probe />);
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  it("follows the element's width as it changes, and stops when it goes", () => {
    let report: (width: number) => void = () => undefined;
    const disconnect = vi.fn<() => void>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(
          callback: (
            entries: Array<{ contentRect: { width: number } }>,
          ) => void,
        ) {
          report = (width) => callback([{ contentRect: { width } }]);
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const { unmount } = render(<Probe />);
    act(() => report(252));
    expect(screen.getByText("252")).toBeInTheDocument();
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
