import { describe, expect, it } from "vitest";
import { parseTypedTime, timeOptions } from "./time-input";

describe("parseTypedTime", () => {
  it.each([
    ["1830", "18:30"],
    ["18:30", "18:30"],
    ["18.30", "18:30"],
    ["9", "09:00"],
    ["930", "09:30"],
    ["0905", "09:05"],
    ["6:30 pm", "18:30"],
    ["12am", "00:00"],
    ["12 pm", "12:00"],
  ])("reads %s as %s", (input, expected) => {
    expect(parseTypedTime(input)).toBe(expected);
  });

  it.each(["", "25:00", "1860", "abc", "7:5", "13pm"])(
    "rejects %s",
    (input) => {
      expect(parseTypedTime(input)).toBeNull();
    },
  );
});

describe("timeOptions", () => {
  it("lists the day in steps", () => {
    const options = timeOptions(15);
    expect(options).toHaveLength(96);
    expect(options.slice(0, 2)).toEqual(["00:00", "00:15"]);
    expect(options.at(-1)).toBe("23:45");
  });
});
