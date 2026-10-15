import { describe, expect, it, vi } from "vitest";
import type { ReleasedConnection } from "@/server/google/release";
import type { OwnerAlertInput } from "@/server/email/owner-alert";
import { type AfterDeletionDeps, afterAccountDeleted } from "./delete-account";

describe("afterAccountDeleted", () => {
  it("revokes what was released and emails each alert, one failure never stopping the rest", async () => {
    const revoke = vi.fn<AfterDeletionDeps["revoke"]>(async () => undefined);
    const send = vi
      .fn<(to: string, alert: OwnerAlertInput) => Promise<void>>()
      .mockRejectedValueOnce(new Error("smtp down"))
      .mockResolvedValue(undefined);
    const released: ReleasedConnection[] = [
      { tokenEncrypted: "v1.x", googleSub: "s", userId: "u" },
    ];
    await afterAccountDeleted(
      {
        released,
        alerts: [
          {
            kind: "sender",
            email: "o1@example.test",
            workspaceName: "A",
            workspaceSlug: "a-1",
          },
          {
            kind: "sheet",
            email: "o2@example.test",
            workspaceName: "B",
            workspaceSlug: "b-1",
          },
        ],
      },
      { revoke, send },
    );
    expect(revoke).toHaveBeenCalledWith(released);
    expect(send).toHaveBeenNthCalledWith(1, "o1@example.test", {
      kind: "senderRemoved",
      workspaceName: "A",
      workspaceSlug: "a-1",
    });
    expect(send).toHaveBeenNthCalledWith(2, "o2@example.test", {
      kind: "sheetPaused",
      reason: "access_lost",
      workspaceName: "B",
      workspaceSlug: "b-1",
    });
  });

  it("sends one email naming both when the account sent for the workspace and held its sheet", async () => {
    const send = vi.fn<(to: string, alert: OwnerAlertInput) => Promise<void>>(
      async () => undefined,
    );
    await afterAccountDeleted(
      {
        released: [],
        alerts: [
          {
            kind: "both",
            email: "o1@example.test",
            workspaceName: "A",
            workspaceSlug: "a-1",
          },
        ],
      },
      { revoke: async () => undefined, send },
    );
    expect(send).toHaveBeenCalledExactlyOnceWith("o1@example.test", {
      kind: "senderAndSheetRemoved",
      workspaceName: "A",
      workspaceSlug: "a-1",
    });
  });

  it("still emails the Owners when revoking fails", async () => {
    const send = vi.fn<(to: string, alert: OwnerAlertInput) => Promise<void>>(
      async () => undefined,
    );
    await afterAccountDeleted(
      {
        released: [{ tokenEncrypted: "v1.x", googleSub: "s", userId: "u" }],
        alerts: [
          {
            kind: "sender",
            email: "o1@example.test",
            workspaceName: "A",
            workspaceSlug: "a-1",
          },
        ],
      },
      { revoke: async () => Promise.reject(new Error("google down")), send },
    );
    expect(send).toHaveBeenCalledOnce();
  });
});
