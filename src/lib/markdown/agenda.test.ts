import { describe, expect, it } from "vitest";
import { renderAgendaHtml } from "./agenda";

describe("renderAgendaHtml", () => {
  it("renders the safe subset", () => {
    const html = renderAgendaHtml(
      "- Recap\n- **Hackathon** teams\n\n[Slides](https://example.test/s) *soon*",
    );
    expect(html).toContain("<ul>");
    expect(html).toContain("<strong>Hackathon</strong>");
    expect(html).toContain(
      '<a href="https://example.test/s" target="_blank" rel="noopener noreferrer">Slides</a>',
    );
    expect(html).toContain("<em>soon</em>");
  });

  it("escapes HTML and drops unsafe links, images and headings", () => {
    const html = renderAgendaHtml(
      "<script>alert(1)</script>\n\n[x](javascript:alert(1)) [y](data:text/html,hi) ![img](https://example.test/a.png)\n\n# Title",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('href="javascript');
    expect(html).not.toContain('href="data');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<h1");
  });

  it("links bare URLs and keeps line breaks", () => {
    const html = renderAgendaHtml("Room B12\nhttps://meet.example.test/abc");
    expect(html).toContain("<br>");
    expect(html).toContain('href="https://meet.example.test/abc"');
  });

  it("returns an empty string for an empty agenda", () => {
    expect(renderAgendaHtml("   ")).toBe("");
  });
});
