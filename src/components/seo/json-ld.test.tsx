import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JsonLd, websiteJsonLd } from "./json-ld";

describe("JsonLd", () => {
  it("writes the data as JSON-LD, with '<' escaped so no text can close the script", () => {
    const { container } = render(
      <JsonLd
        data={{ "@context": "https://schema.org", name: "</script><b>x" }}
      />,
    );
    const script = container.querySelector(
      'script[type="application/ld+json"]',
    );
    expect(script?.innerHTML).toBe(
      '{"@context":"https://schema.org","name":"\\u003c/script>\\u003cb>x"}',
    );
    expect(JSON.parse(script?.textContent ?? "")).toEqual({
      "@context": "https://schema.org",
      name: "</script><b>x",
    });
  });
});

describe("websiteJsonLd", () => {
  it("names the site at its home page (Google's site names: WebSite, name and url)", () => {
    expect(websiteJsonLd("https://www.tapnshow.tn")).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "TapNShow",
      url: "https://www.tapnshow.tn/",
    });
  });
});
