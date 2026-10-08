import { describe, expect, it } from "vitest";
import { parsePeopleList } from "./parse-people";

describe("parsePeopleList", () => {
  it("reads the common pasted shapes", () => {
    expect(
      parsePeopleList(
        "Nour Hamdi, nour@uni.tn\nSami Trabelsi <SAMI@uni.tn>\nLina\tlina@uni.tn\nAhmed;ahmed@uni.tn\n\n",
      ),
    ).toEqual([
      { fullName: "Nour Hamdi", email: "nour@uni.tn", problem: null },
      { fullName: "Sami Trabelsi", email: "sami@uni.tn", problem: null },
      { fullName: "Lina", email: "lina@uni.tn", problem: null },
      { fullName: "Ahmed", email: "ahmed@uni.tn", problem: null },
    ]);
  });

  it("flags a missing name or a bad email instead of dropping the line", () => {
    expect(parsePeopleList("guest@uni.tn\nBob, not-an-email")).toEqual([
      { fullName: "", email: "guest@uni.tn", problem: "name" },
      { fullName: "Bob", email: "not-an-email", problem: "email" },
    ]);
  });

  it("accepts email-first lines", () => {
    expect(parsePeopleList("nour@uni.tn, Nour Hamdi")).toEqual([
      { fullName: "Nour Hamdi", email: "nour@uni.tn", problem: null },
    ]);
  });
});
