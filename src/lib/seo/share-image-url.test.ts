import { describe, expect, it } from "vitest";
import { APP_NAME } from "@/config/app";
import { SHARE_IMAGE, SHARE_IMAGE_LINE } from "@/config/share-image";
import { appIconSvg } from "@/lib/brand/app-icon";
import {
  SHARE_IMAGE_URL,
  shareImageVersion,
  VERSIONED_SHARE_IMAGE,
} from "./share-image-url";

describe("shareImageVersion", () => {
  it("names the picture by what it shows: same parts, same version; any change, a new one", () => {
    expect(shareImageVersion(["a", "b"])).toMatch(/^[0-9a-f]{10}$/);
    expect(shareImageVersion(["a", "b"])).toBe(shareImageVersion(["a", "b"]));
    expect(shareImageVersion(["a", "c"])).not.toBe(
      shareImageVersion(["a", "b"]),
    );
    // The parts are joined with a newline before hashing.
    expect(shareImageVersion(["a\nb"])).toBe(shareImageVersion(["a", "b"]));
  });
});

describe("SHARE_IMAGE_URL", () => {
  it("is the image route with the version of the mark, the name and the line", () => {
    expect(SHARE_IMAGE_URL).toBe(
      `/opengraph-image?v=${shareImageVersion([appIconSvg("full"), APP_NAME, SHARE_IMAGE_LINE])}`,
    );
  });
});

describe("VERSIONED_SHARE_IMAGE", () => {
  it("is the share card's image at its versioned address", () => {
    expect(VERSIONED_SHARE_IMAGE).toEqual({
      ...SHARE_IMAGE,
      url: SHARE_IMAGE_URL,
    });
  });
});
