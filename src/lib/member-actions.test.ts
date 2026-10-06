import { describe, expect, it } from "vitest";
import type { Member } from "@/shared/api/members";
import { memberActions } from "./member-actions";

const member = (userId: string, role: Member["role"]): Member => ({
  userId,
  role,
  canCheckIn: false,
  displayName: userId,
  avatarUrl: null,
  email: `${userId}@example.test`,
  joinedAt: "2026-10-05T00:00:00Z",
});

describe("memberActions", () => {
  it("Owner manages Admins and Viewers, never the Owner row or themselves", () => {
    expect(memberActions("owner", "me", member("a", "admin"))).toEqual([
      "makeViewer",
      "remove",
    ]);
    expect(memberActions("owner", "me", member("v", "viewer"))).toEqual([
      "makeAdmin",
      "toggleCheckIn",
      "remove",
    ]);
    expect(memberActions("owner", "me", member("me", "owner"))).toEqual([]);
  });

  it("Admins manage Viewers only", () => {
    expect(memberActions("admin", "me", member("a", "admin"))).toEqual([]);
    expect(memberActions("admin", "me", member("v", "viewer"))).toEqual([
      "toggleCheckIn",
      "remove",
    ]);
    expect(memberActions("admin", "me", member("o", "owner"))).toEqual([]);
  });

  it("Viewers manage nobody", () => {
    expect(memberActions("viewer", "me", member("v", "viewer"))).toEqual([]);
  });
});
