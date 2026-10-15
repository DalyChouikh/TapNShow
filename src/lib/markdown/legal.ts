import MarkdownIt from "markdown-it";

/**
 * Renderer for the legal pages' own Markdown (written in the repo, not by users): paragraphs,
 * lists, emphasis and links; raw HTML escaped. Outside links open in a new tab.
 */
const markdown = new MarkdownIt("zero", {
  html: false,
  linkify: false,
  breaks: false,
}).enable(["paragraph", "list", "emphasis", "link", "escape"]);

const SAFE_LINK = /^(https?:|mailto:|\/|#)/i;
markdown.validateLink = (url: string) => SAFE_LINK.test(url.trim());

const renderLinkOpen = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const href = String(tokens[index].attrGet("href") ?? "");
  if (/^https?:/i.test(href)) {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noopener noreferrer");
  }
  return renderLinkOpen
    ? renderLinkOpen(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options);
};

/** HTML for one legal section's body. */
export function renderLegalHtml(source: string): string {
  return markdown.render(source).trim();
}
