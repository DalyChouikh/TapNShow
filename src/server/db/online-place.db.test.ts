import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { addToList, seedMeeting } from "@/test/db/meetings";
import { serviceRpc } from "@/test/db/outbox";
import { seedContacts, seedList } from "@/test/db/roster";
import { seedConnection, setSender } from "@/test/db/sender";
import { runLocalSql } from "@/test/db/sql";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

let owner: TestUser;
let workspace: TestWorkspace;
let list: string;

beforeEach(async () => {
  runLocalSql(
    "update public.outbox_jobs set status = 'done' where status in ('pending', 'processing', 'paused')",
  );
  runLocalSql("delete from public.sender_leases");
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "Online Club");
  await setSender(workspace.id, await seedConnection(owner.id));
  const people = await seedContacts(
    workspace.id,
    1,
    `on-${crypto.randomUUID().slice(0, 6)}`,
  );
  list = await seedList(workspace.id, "Members");
  await addToList(workspace.id, list, people);
});

async function onlineMeeting(onlineText: string, meetingUrl: string) {
  const id = await seedMeeting(workspace.id, {
    location_mode: "online",
    location_text: "",
    meeting_url: meetingUrl,
    created_by: owner.id,
  });
  const { error } = await adminClient()
    .from("meetings")
    .update({ online_text: onlineText })
    .eq("id", id);
  expect(error).toBeNull();
  await owner.client.rpc("set_meeting_audience", {
    p_meeting: id,
    p_list_ids: [list],
    p_include: [],
    p_exclude: [],
  });
  return id;
}

describe("online place", () => {
  it("new meetings start with the workspace's usual online place", async () => {
    const { error } = await adminClient()
      .from("workspaces")
      .update({
        default_online_text: "Club Discord, Meetings voice",
        default_meeting_url: "https://discord.gg/abc123",
      })
      .eq("id", workspace.id);
    expect(error).toBeNull();
    const created = await owner.client.rpc("create_meeting", {
      p_workspace: workspace.id,
    });
    const row = await adminClient()
      .from("meetings")
      .select("online_text, meeting_url")
      .eq("id", created.data ?? "")
      .single();
    expect(row.data).toEqual({
      online_text: "Club Discord, Meetings voice",
      meeting_url: "https://discord.gg/abc123",
    });
  });

  it("sends an online meeting with only a place, and refuses one with neither", async () => {
    const withPlace = await onlineMeeting("Club Discord", "");
    expect(
      (await owner.client.rpc("send_meeting", { p_meeting: withPlace })).error,
    ).toBeNull();
    const empty = await onlineMeeting("", "");
    await expectAppError(
      owner.client.rpc("send_meeting", { p_meeting: empty }),
      "meeting_incomplete",
    );
  });

  it("hands the online place to the dispatcher and the public token page", async () => {
    const id = await onlineMeeting("Club Discord", "");
    await owner.client.rpc("send_meeting", { p_meeting: id });
    const claim = z
      .object({
        jobs: z.array(
          z.object({
            invitee_id: z.uuid(),
            meeting: z.object({ id: z.uuid(), online_text: z.string() }),
          }),
        ),
      })
      .parse(
        await serviceRpc("dispatch_claim", {
          p_run: crypto.randomUUID(),
          p_limit: 50,
          p_lease_seconds: 70,
        }),
      );
    const job = claim.jobs.find((j) => j.meeting.id === id);
    expect(job?.meeting.online_text).toBe("Club Discord");
    const hash = crypto.randomUUID().replaceAll("-", "").repeat(2);
    await adminClient()
      .from("meeting_invitees")
      .update({ token_hash: hash })
      .eq("id", job?.invitee_id ?? "");
    const info = z
      .object({ meeting: z.object({ online_text: z.string() }) })
      .parse(await serviceRpc("token_invitee", { p_token_hash: hash }));
    expect(info.meeting.online_text).toBe("Club Discord");
  });

  it("lets organizers change the online place and the workspace default", async () => {
    const id = await seedMeeting(workspace.id, { created_by: owner.id });
    expect(
      (
        await owner.client
          .from("meetings")
          .update({ online_text: "Zoom room 2" })
          .eq("id", id)
      ).error,
    ).toBeNull();
    expect(
      (
        await owner.client
          .from("workspaces")
          .update({ default_online_text: "Club Discord" })
          .eq("id", workspace.id)
      ).error,
    ).toBeNull();
  });
});
