import { describe, expect, it } from "vitest";
import { renderLegalHtml } from "./legal";

describe("renderLegalHtml", () => {
  it("renders paragraphs, lists, emphasis and our own links", () => {
    const html = renderLegalHtml(
      "We **never** sell data.\n\n- one\n- two\n\nSee [Terms](/terms).",
    );
    expect(html).toContain("<strong>never</strong>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain('<a href="/terms">Terms</a>');
  });

  it("escapes raw HTML and opens outside links in a new tab", () => {
    const html = renderLegalHtml(
      "<script>x</script> [Google](https://policies.google.com)",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain(
      'href="https://policies.google.com" target="_blank" rel="noopener noreferrer"',
    );
  });
});
