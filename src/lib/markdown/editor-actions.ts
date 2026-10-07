/** The agenda toolbar's buttons. */
export type MarkdownAction = "bold" | "italic" | "list" | "link";

const WRAP: Record<"bold" | "italic", { mark: string; placeholder: string }> = {
  bold: { mark: "**", placeholder: "bold" },
  italic: { mark: "*", placeholder: "italic" },
};

/** Applies one toolbar action to the text and returns the new text and selection. */
export function applyMarkdownAction(
  text: string,
  start: number,
  end: number,
  action: MarkdownAction,
): { text: string; start: number; end: number } {
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);
  if (action === "bold" || action === "italic") {
    const { mark, placeholder } = WRAP[action];
    const inner = selected || placeholder;
    return {
      text: `${before}${mark}${inner}${mark}${after}`,
      start: start + mark.length,
      end: start + mark.length + inner.length,
    };
  }
  if (action === "link") {
    const label = selected || "link";
    const url = "https://";
    const urlStart = start + label.length + 3;
    return {
      text: `${before}[${label}](${url})${after}`,
      start: urlStart,
      end: urlStart + url.length,
    };
  }
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const block = text.slice(lineStart, end);
  const listed = block
    .split("\n")
    .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
    .join("\n");
  return {
    text: `${text.slice(0, lineStart)}${listed}${after}`,
    start: lineStart,
    end: lineStart + listed.length,
  };
}
