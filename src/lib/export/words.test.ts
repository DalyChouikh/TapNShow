import { describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";
import { exportHeaders, exportWords } from "./words";

describe("exportWords", () => {
  const words = exportWords("en", messages);

  it("translates answers, delivery, check-ins and headers like the screens", () => {
    expect(words.labels.attending).toBe("Going");
    expect(words.labels.late(20)).toBe("Late by 20 min");
    expect(words.text.emailStatus("unknown")).toBe("Delivery unknown");
    expect(words.text.actual("present")).toBe("Present");
    expect(words.text.yes).toBe("Yes");
    expect(words.text.noReply).toBe("No reply");
    expect(words.column("wasLateBy")).toBe("Was late by (min)");
    expect(words.column("answeredAt")).toBe("Answered at");
  });

  it("turns columns into a sheet's header row: word, width, tone", () => {
    expect(
      exportHeaders(words, [
        { key: "group", width: 24 },
        { key: "late", width: 10, tone: "warning" },
      ]),
    ).toEqual([
      { header: "Group", width: 24, tone: undefined },
      { header: "Late", width: 10, tone: "warning" },
    ]);
  });
});
