import { describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, createTestUser, expectAppError } from "@/test/db/clients";
import { hoursFromNow } from "@/test/db/meetings";
import { seedAnswer, seedContact, seedInviteFor } from "@/test/db/members";
import { overrideLimit } from "@/test/db/outbox";
import { seedConnection, setSender } from "@/test/db/sender";
import { dirtyYears, seedSheet } from "@/test/db/sheets";
import { addMember, createWorkspaceAs } from "@/test/db/workspaces";

const resultSchema = z.object({
  released: z.array(z.object({ google_sub: z.string(), user_id: z.uuid() })),
  alerts: z.array(
    z.object({
      kind: z.enum(["sender", "sheet", "both"]),
      email: z.string(),
      workspace_name: z.string(),
      workspace_slug: z.string(),
    }),
  ),
});

async function deleteAs(
  user: Awaited<ReturnType<typeof createTestUser>>,
  word = "confirm",
) {
  const { data, error } = await user.client.rpc("delete_account", {
    p_confirm: word,
  } as never);
  if (error) {
    throw error;
  }
  return resultSchema.parse(data);
}

describe("delete_account (spec §11 Account deletion)", () => {
  it("refuses the wrong word, and refuses while the person owns a workspace", async () => {
    const owner = await createTestUser();
    await createWorkspaceAs(owner, "Owned");
    await expectAppError(
      owner.client.rpc("delete_account", { p_confirm: "Confirm" } as never),
      "name_mismatch",
    );
    await expectAppError(
      owner.client.rpc("delete_account", { p_confirm: "confirm" } as never),
      "owns_workspaces",
    );
    const { count } = await adminClient()
      .from("workspace_roles")
      .select("*", { count: "exact", head: true })
      .eq("user_id", owner.id);
    expect(count).toBe(1);
  });

  it("erases reasons and comments in answers and history everywhere, keeps the statuses, marks the sheet", async () => {
    const organizer = await createTestUser();
    const member = await createTestUser();
    const clubA = await createWorkspaceAs(organizer, "Club A");
    const clubB = await createWorkspaceAs(organizer, "Club B");
    const sheetOwner = await seedConnection(organizer.id, {
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    await seedSheet(clubA.id, sheetOwner.id, {
      googleSub: sheetOwner.sub,
      spreadsheetId: "fake-file-000901",
    });
    const a = await seedInviteFor(
      clubA.id,
      await seedContact(clubA.id, member.email),
      { starts_at: hoursFromNow(-48) },
    );
    const b = await seedInviteFor(
      clubB.id,
      await seedContact(clubB.id, member.email),
      { starts_at: hoursFromNow(24) },
    );
    await seedAnswer(clubA.id, a.meetingId, a.inviteeId, {
      status: "absent",
      reason: "Exam",
      comment: "Sorry",
    });
    await seedAnswer(clubB.id, b.meetingId, b.inviteeId, {
      status: "late",
      delay_minutes: 10,
      reason: "Bus",
    });
    await adminClient()
      .from("sheet_dirty_years")
      .delete()
      .eq("workspace_id", clubA.id);

    await deleteAs(member);

    const { data: answers } = await adminClient()
      .from("responses")
      .select("status, reason, comment")
      .in("invitee_id", [a.inviteeId, b.inviteeId])
      .order("status");
    // Ordered by the response_status enum (attending, late, absent, not_attending).
    expect(answers).toEqual([
      { status: "late", reason: "", comment: "" },
      { status: "absent", reason: "", comment: "" },
    ]);
    const { data: history } = await adminClient()
      .from("response_history")
      .select("reason, comment")
      .in("invitee_id", [a.inviteeId, b.inviteeId]);
    expect(
      history?.every((row) => row.reason === "" && row.comment === ""),
    ).toBe(true);
    expect((await dirtyYears(clubA.id)).length).toBeGreaterThan(0);
  });

  it("leaves every workspace, stops the sending that used their Gmail and tells the Owner once", async () => {
    const owner = await createTestUser();
    const admin = await createTestUser();
    const club = await createWorkspaceAs(owner, "Sender Club");
    await addMember(club.id, admin.id, "admin");
    const gmail = await seedConnection(admin.id);
    await setSender(club.id, gmail.id);

    const result = await deleteAs(admin);

    const { data: workspace } = await adminClient()
      .from("workspaces")
      .select("sender_connection_id")
      .eq("id", club.id)
      .single();
    expect(workspace?.sender_connection_id).toBeNull();
    expect(result.alerts).toEqual([
      {
        kind: "sender",
        email: owner.email,
        workspace_name: "Sender Club",
        workspace_slug: club.slug,
      },
    ]);
    expect(result.released.map((row) => row.google_sub)).toEqual([gmail.sub]);
    const { count } = await adminClient()
      .from("workspace_roles")
      .select("*", { count: "exact", head: true })
      .eq("user_id", admin.id);
    expect(count).toBe(0);
  });

  it("pauses a sheet in their Drive and never revokes a Google account another person still uses", async () => {
    const owner = await createTestUser();
    const admin = await createTestUser();
    const colleague = await createTestUser();
    const club = await createWorkspaceAs(owner, "Sheet Club");
    await addMember(club.id, admin.id, "admin");
    const shared = `sub-shared-${crypto.randomUUID()}`;
    const theirs = await seedConnection(admin.id, {
      sub: shared,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    await seedConnection(colleague.id, { sub: shared });
    await seedSheet(club.id, theirs.id, {
      googleSub: shared,
      spreadsheetId: "fake-file-000902",
    });

    const result = await deleteAs(admin);

    expect(result.released).toEqual([]);
    expect(result.alerts.map((alert) => alert.kind)).toEqual(["sheet"]);
    const { data: sheet } = await adminClient()
      .from("sheet_syncs")
      .select("status, paused_reason, connection_id, google_sub")
      .eq("workspace_id", club.id)
      .single();
    expect(sheet).toEqual({
      status: "paused",
      paused_reason: "access_lost",
      connection_id: null,
      google_sub: shared,
    });
    const { count } = await adminClient()
      .from("google_connections")
      .select("*", { count: "exact", head: true })
      .eq("user_id", colleague.id);
    expect(count).toBe(1);
  });

  it("tells an Owner once when one account both sent for the workspace and held its sheet", async () => {
    const owner = await createTestUser();
    const admin = await createTestUser();
    const club = await createWorkspaceAs(owner, "Both Club");
    await addMember(club.id, admin.id, "admin");
    const google = await seedConnection(admin.id, {
      scopes: [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/drive.file",
      ],
    });
    await setSender(club.id, google.id);
    await seedSheet(club.id, google.id, {
      googleSub: google.sub,
      spreadsheetId: "fake-file-000904",
    });

    const result = await deleteAs(admin);

    expect(result.alerts).toEqual([
      {
        kind: "both",
        email: owner.email,
        workspace_name: "Both Club",
        workspace_slug: club.slug,
      },
    ]);
  });

  it("still tells an Owner about sending when the sheet alert went out today", async () => {
    const owner = await createTestUser();
    const admin = await createTestUser();
    const club = await createWorkspaceAs(owner, "Sent Club");
    await addMember(club.id, admin.id, "admin");
    const google = await seedConnection(admin.id, {
      scopes: [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/drive.file",
      ],
    });
    await setSender(club.id, google.id);
    await seedSheet(club.id, google.id, {
      googleSub: google.sub,
      spreadsheetId: "fake-file-000905",
    });
    await adminClient()
      .from("sheet_syncs")
      .update({ alerted_at: new Date(Date.now() - 3_600_000).toISOString() })
      .eq("workspace_id", club.id);

    const result = await deleteAs(admin);

    expect(result.alerts.map((alert) => alert.kind)).toEqual(["sender"]);
  });

  it("doesn't email an Owner twice in a day about the same sheet", async () => {
    const owner = await createTestUser();
    const admin = await createTestUser();
    const club = await createWorkspaceAs(owner, "Quiet Club");
    await addMember(club.id, admin.id, "admin");
    const theirs = await seedConnection(admin.id, {
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    await seedSheet(club.id, theirs.id, {
      googleSub: theirs.sub,
      spreadsheetId: "fake-file-000903",
    });
    const { error } = await adminClient()
      .from("sheet_syncs")
      .update({ alerted_at: new Date(Date.now() - 3_600_000).toISOString() })
      .eq("workspace_id", club.id);
    expect(error).toBeNull();

    const result = await deleteAs(admin);

    expect(result.alerts).toEqual([]);
    const { data: sheet } = await adminClient()
      .from("sheet_syncs")
      .select("status, paused_reason")
      .eq("workspace_id", club.id)
      .single();
    expect(sheet).toEqual({ status: "paused", paused_reason: "access_lost" });
  });

  it("is harmless when called again, and rate limited", async () => {
    const member = await createTestUser();
    await deleteAs(member);
    expect(await deleteAs(member)).toEqual({ released: [], alerts: [] });
    // Two deletions spent; a limit of 2 refuses the third.
    const restore = overrideLimit("account_deletions_per_user_per_hour", 2);
    try {
      await expectAppError(
        member.client.rpc("delete_account", { p_confirm: "confirm" } as never),
        "rate_limited",
      );
    } finally {
      restore();
    }
  });

  it("the auth user's removal (the route's next step) cascades to the profile", async () => {
    const member = await createTestUser();
    await deleteAs(member);
    const removed = await adminClient().auth.admin.deleteUser(member.id);
    expect(removed.error).toBeNull();
    const { count } = await adminClient()
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("user_id", member.id);
    expect(count).toBe(0);
  });
});
