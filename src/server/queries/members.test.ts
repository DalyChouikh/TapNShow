import { describe, expect, it } from "vitest";
import { listMembersPage } from "./members";

describe("listMembersPage", () => {
  it("reads a database from before the #413 migration as no sheet tag", async () => {
    // A deploy (or a PR preview) can go live before its migration reaches that database.
    const before = {
      has_more: false,
      items: [
        {
          user_id: "0a0a0a0a-0000-4000-8000-000000000001",
          role: "viewer",
          can_check_in: false,
          display_name: "Nour",
          avatar_url: null,
          email: "nour@example.test",
          joined_at: "2026-10-05T00:00:00Z",
          sort_name: "nour",
        },
      ],
    };
    const client = { rpc: async () => ({ data: before, error: null }) };
    const { data } = await listMembersPage(
      client as never,
      "w1",
      null,
      50,
      null,
    );
    expect(data?.items[0].sheetAccess).toBeNull();
  });
});
