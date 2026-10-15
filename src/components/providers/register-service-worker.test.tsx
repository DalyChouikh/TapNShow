import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const sw = vi.hoisted(() => {
  const register = vi.fn<() => Promise<undefined>>();
  // One instance for the page's life, like SerwistProvider's state.
  return { register, context: { serwist: { register } } };
});
vi.mock("@serwist/turbopack/react", () => ({ useSerwist: () => sw.context }));

const { RegisterServiceWorker } = await import("./register-service-worker");

describe("RegisterServiceWorker", () => {
  it("registers the worker once, and handles a browser that refuses it", async () => {
    const refused = Promise.reject<undefined>(
      new DOMException(
        "The script resource is behind a redirect",
        "SecurityError",
      ),
    );
    const handled = vi.spyOn(refused, "catch");
    sw.register.mockReturnValueOnce(refused);
    const { container, rerender } = render(<RegisterServiceWorker />);
    rerender(<RegisterServiceWorker />);
    expect(sw.register).toHaveBeenCalledOnce();
    // A refusal is expected (private windows, protected deployment addresses): never unhandled.
    expect(handled).toHaveBeenCalledOnce();
    await expect(refused).rejects.toThrow("behind a redirect");
    expect(container).toBeEmptyDOMElement();
  });
});
