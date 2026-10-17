import { describe, expect, it, vi } from "vitest";

const readFile = vi.hoisted(() =>
  vi.fn<(path: string) => Promise<Buffer>>(async () => Buffer.from("font")),
);

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  // Both forms: the transformed module may read it through the default export.
  return { ...actual, readFile, default: { ...actual, readFile } };
});

describe("the link preview image route", () => {
  it("reads its font only when the image is drawn, never when a page imports the route's metadata", async () => {
    // Next imports this module into every page for its alt, size and content type.
    const route = await import("./opengraph-image");
    expect(readFile).not.toHaveBeenCalled();

    await route.default();
    await route.default();
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile.mock.calls[0]?.[0]).toMatch(
      /src\/assets\/fonts\/archivo-black-400\.ttf$/,
    );
  });
});
