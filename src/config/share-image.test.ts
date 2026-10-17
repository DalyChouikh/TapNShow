import { describe, expect, it } from "vitest";
import messages from "../../messages/en.json";
import { SHARE_IMAGE, SHARE_IMAGE_LINE } from "./share-image";

describe("the link preview image", () => {
  it("says the landing's title (ImageResponse can't read messages, so the twin is pinned here)", () => {
    expect(SHARE_IMAGE_LINE).toBe(messages.Landing.title);
  });

  it("is 1200 × 630 PNG at /opengraph-image, described by the product line", () => {
    expect(SHARE_IMAGE).toEqual({
      url: "/opengraph-image",
      width: 1200,
      height: 630,
      type: "image/png",
      alt: `TapNShow: ${SHARE_IMAGE_LINE}`,
    });
  });
});
