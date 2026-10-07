import { describe, expect, it } from "vitest";
import { applyMarkdownAction } from "./editor-actions";

describe("applyMarkdownAction", () => {
  it("wraps the selection in bold or italic and keeps it selected", () => {
    expect(applyMarkdownAction("Hackathon teams", 0, 9, "bold")).toEqual({
      text: "**Hackathon** teams",
      start: 2,
      end: 11,
    });
    expect(applyMarkdownAction("soon", 0, 4, "italic")).toEqual({
      text: "*soon*",
      start: 1,
      end: 5,
    });
  });

  it("inserts a placeholder when nothing is selected", () => {
    expect(applyMarkdownAction("", 0, 0, "bold")).toEqual({
      text: "**bold**",
      start: 2,
      end: 6,
    });
  });

  it("turns the selected lines into a list", () => {
    expect(applyMarkdownAction("Recap\nTeams", 0, 11, "list")).toEqual({
      text: "- Recap\n- Teams",
      start: 0,
      end: 15,
    });
  });

  it("makes a link with the URL part selected", () => {
    expect(applyMarkdownAction("Slides", 0, 6, "link")).toEqual({
      text: "[Slides](https://)",
      start: 9,
      end: 17,
    });
  });
});
