import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

afterEach(() => vi.unstubAllGlobals());

describe("copyText", () => {
  it("writes the text and says it worked", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(
      async () => undefined,
    );
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("confirm")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("confirm");
  });

  it("says it failed instead of throwing when the browser refuses", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: async () => Promise.reject(new Error("denied")) },
    });
    expect(await copyText("confirm")).toBe(false);
    vi.stubGlobal("navigator", {});
    expect(await copyText("confirm")).toBe(false);
  });
});
