import { describe, expect, it } from "vitest";
import { webManifest } from "@/config/web-manifest";
import { GET } from "./route";

describe("GET /manifest.webmanifest", () => {
  it("serves the web app manifest as a manifest", async () => {
    const response = GET();
    expect(response.headers.get("content-type")).toBe(
      "application/manifest+json",
    );
    expect(await response.json()).toEqual(webManifest());
  });
});
