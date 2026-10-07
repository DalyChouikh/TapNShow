import MarkdownIt from "markdown-it";

/**
 * The agenda renderer shared by the wizard preview and the invite email (spec §9): starts from
 * markdown-it's "zero" preset and enables only paragraphs, line breaks, emphasis, lists and links.
 * Raw HTML is escaped (`html: false`); only http(s) and mailto links survive.
 */
const markdown = new MarkdownIt("zero", {
  html: false,
  linkify: true,
  breaks: true,
}).enable([
  "list",
  "emphasis",
  "link",
  "linkify",
  "autolink",
  "newline",
  "escape",
]);

const SAFE_LINK = /^(https?:|mailto:)/i;
markdown.validateLink = (url: string) => SAFE_LINK.test(url.trim());

const renderLinkOpen = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet("target", "_blank");
  tokens[index].attrSet("rel", "noopener noreferrer");
  return renderLinkOpen
    ? renderLinkOpen(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options);
};

/** Safe HTML for a Markdown agenda ("" when empty). */
export function renderAgendaHtml(source: string): string {
  return source.trim() ? markdown.render(source).trim() : "";
}
