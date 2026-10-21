import { describe, expect, it } from "vitest";
import { getWorkspaceSheet } from "./sheets";

describe("getWorkspaceSheet", () => {
  it("reads a database from before the #413 migration as sharing switched off", async () => {
    // A deploy (or a PR preview) can go live before its migration reaches that database.
    const before = {
      state: "off",
      spreadsheet_id: null,
      paused_reason: null,
      synced_at: null,
      behind: false,
      created_at: null,
      turned_on_by: "",
      account_email: null,
      owner_name: "Sara",
      tabs: [],
    };
    const client = { rpc: async () => ({ data: before, error: null }) };
    const { data } = await getWorkspaceSheet(client as never, "w1");
    expect(data?.sharing).toBeNull();
  });
});
