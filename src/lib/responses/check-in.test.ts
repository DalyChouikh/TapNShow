import { describe, expect, it } from "vitest";
import { workspaceFixture } from "@/test/fixtures/me";
import { canCheckIn, declaredActual } from "./check-in";

describe("declaredActual", () => {
  it("suggests the check-in an answer implies, nothing without an answer", () => {
    expect(declaredActual("attending")).toBe("present");
    expect(declaredActual("late")).toBe("late");
    expect(declaredActual("absent")).toBe("absent");
    expect(declaredActual("not_attending")).toBe("absent");
    expect(declaredActual(null)).toBeNull();
  });
});

describe("canCheckIn", () => {
  it("lets Owners, Admins and Viewers with check-in mark people", () => {
    expect(canCheckIn({ ...workspaceFixture, myRole: "owner" })).toBe(true);
    expect(canCheckIn({ ...workspaceFixture, myRole: "admin" })).toBe(true);
    expect(
      canCheckIn({ ...workspaceFixture, myRole: "viewer", canCheckIn: false }),
    ).toBe(false);
    expect(
      canCheckIn({ ...workspaceFixture, myRole: "viewer", canCheckIn: true }),
    ).toBe(true);
  });
});
