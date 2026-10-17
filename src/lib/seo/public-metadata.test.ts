import { describe, expect, it } from "vitest";
import { SHARE_IMAGE } from "@/config/share-image";
import { legalPageMetadata, publicPageMetadata } from "./public-metadata";
import { SHARE_IMAGE_URL } from "./share-image-url";

describe("publicPageMetadata", () => {
  it("gives a public page its canonical address and a complete share card", () => {
    expect(
      publicPageMetadata({
        path: "/privacy",
        title: "Privacy Policy · TapNShow",
        description: "What we keep.",
      }),
    ).toEqual({
      title: "Privacy Policy · TapNShow",
      description: "What we keep.",
      alternates: { canonical: "/privacy" },
      openGraph: {
        type: "website",
        url: "/privacy",
        siteName: "TapNShow",
        locale: "en_US",
        title: "Privacy Policy · TapNShow",
        description: "What we keep.",
        images: [{ ...SHARE_IMAGE, url: SHARE_IMAGE_URL }],
      },
    });
  });
});

describe("legalPageMetadata", () => {
  it("names a legal page after its title and describes it by its summary", () => {
    const meta = legalPageMetadata(
      {
        title: "Terms of Service",
        updated: "2026-10-16",
        summary: ["TapNShow is free.", "Second line."],
        sections: [],
      },
      "/terms",
    );
    expect(meta).toMatchObject({
      title: "Terms of Service · TapNShow",
      description: "TapNShow is free.",
      alternates: { canonical: "/terms" },
      openGraph: { url: "/terms", title: "Terms of Service · TapNShow" },
    });
  });
});
