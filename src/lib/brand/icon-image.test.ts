import { describe, expect, it } from "vitest";
import { appIconSvg } from "./app-icon";
import { appIconDataUri } from "./icon-image";

describe("appIconDataUri", () => {
  it("is the icon's SVG as a base64 data URI, for <img> in ImageResponse", () => {
    const uri = appIconDataUri("full");
    const prefix = "data:image/svg+xml;base64,";
    expect(uri.startsWith(prefix)).toBe(true);
    expect(Buffer.from(uri.slice(prefix.length), "base64").toString()).toBe(
      appIconSvg("full"),
    );
  });
});
