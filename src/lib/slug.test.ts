import { describe, expect, it } from "vitest";
import { generateWorkspaceSlug, slugBase } from "./slug";

const fixedBytes = () => new Uint8Array([0, 1, 2, 3]);

describe("slugBase", () => {
  it.each([
    ["GDG on Campus ISSAT Sousse", "gdg-on-campus-issat-sousse"],
    ["Club Électronique", "club-electronique"],
    ["  Débat & Co.  ", "debat-co"],
    ["نادي البرمجة", "workspace"],
    ["🎉🎉", "workspace"],
    ["a".repeat(100), "a".repeat(40)],
  ])("%s → %s", (name, expected) => {
    expect(slugBase(name)).toBe(expected);
  });
});

describe("generateWorkspaceSlug", () => {
  it("appends a 4-character suffix from an unambiguous alphabet", () => {
    expect(generateWorkspaceSlug("Robotics", fixedBytes)).toBe("robotics-abcd");
    expect(generateWorkspaceSlug("نادي")).toMatch(
      /^workspace-[a-km-np-z2-9]{4}$/,
    );
  });

  it("always matches the database slug check", () => {
    for (const name of ["x", "Ünïcödé Ñame", "--a--", "A-B_C.D"]) {
      expect(generateWorkspaceSlug(name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});
