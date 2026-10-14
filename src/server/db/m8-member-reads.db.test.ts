import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  anonClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { hoursFromNow } from "@/test/db/meetings";
import { seedAnswer, seedContact, seedInviteFor } from "@/test/db/members";
import { overrideLimit } from "@/test/db/outbox";
import { explainCall, planUsesIndex } from "@/test/db/plans";
import { seedContacts } from "@/test/db/roster";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

const itemSchema = z.object({
  invitee_id: z.uuid(),
  workspace_name: z.string(),
  title: z.string(),
  starts_at: z.string(),
  needs_answer: z.boolean(),
  status: z.string(),
  answer: z
    .object({
      status: z.string(),
      reason: z.string(),
      needs_reconfirmation: z.boolean(),
    })
    .nullable(),
  mark: z
    .object({ actual: z.string(), late_minutes: z.number().nullable() })
    .nullable(),
});
const pageSchema = z.object({
  has_more: z.boolean(),
  needs_count: z.number().int(),
  as_of: z.string(),
  items: z.array(itemSchema),
});

async function invitesOf(
  user: TestUser,
  args: {
    tab?: "upcoming" | "past";
    filter?: "all" | "needs";
    after?: [string, string] | null;
    limit?: number;
  } = {},
) {
  const { data, error } = await user.client.rpc("my_invites", {
    p_tab: args.tab ?? "upcoming",
    p_filter: args.filter ?? "all",
    p_after_starts: args.after?.[0] ?? null,
    p_after_invitee: args.after?.[1] ?? null,
    p_limit: args.limit ?? 50,
  } as never);
  if (error) {
    throw error;
  }
  return pageSchema.parse(data);
}

let organizer: TestUser;
let member: TestUser;
let other: TestUser;
let clubA: TestWorkspace;
let clubB: TestWorkspace;

beforeAll(async () => {
  organizer = await createTestUser();
  member = await createTestUser();
  other = await createTestUser();
  clubA = await createWorkspaceAs(organizer, "Club A");
  clubB = await createWorkspaceAs(organizer, "Club B");
});

describe("matching invites to accounts (spec §6 Identity rules)", () => {
  it("lists sent invites to the verified email, across workspaces, ad-hoc included", async () => {
    const inA = await seedContact(clubA.id, member.email);
    const inB = await seedContact(clubB.id, member.email, { isAdhoc: true });
    const stranger = await seedContact(
      clubA.id,
      `x-${crypto.randomUUID()}@example.test`,
    );
    const a = await seedInviteFor(clubA.id, inA, {
      title: "A sync",
      starts_at: hoursFromNow(48),
    });
    const b = await seedInviteFor(clubB.id, inB, {
      title: "B sync",
      starts_at: hoursFromNow(72),
    });
    await seedInviteFor(clubA.id, stranger, { starts_at: hoursFromNow(24) });
    await seedInviteFor(
      clubA.id,
      inA,
      { starts_at: hoursFromNow(30) },
      { sent: false },
    );

    const page = await invitesOf(member);
    expect(page.items.map((item) => item.invitee_id)).toEqual([
      a.inviteeId,
      b.inviteeId,
    ]);
    expect(page.items.map((item) => item.workspace_name)).toEqual([
      "Club A",
      "Club B",
    ]);
  });

  it("matches an address typed in mixed case at sign-up (auth stores it lower-cased)", async () => {
    const mixed = await createTestUser({
      email: `Mixed.Case-${crypto.randomUUID().slice(0, 8)}@Example.Test`,
    });
    const contact = await seedContact(clubA.id, mixed.email.toLowerCase());
    const invite = await seedInviteFor(clubA.id, contact, {
      starts_at: hoursFromNow(5),
    });
    expect(
      (await invitesOf(mixed)).items.map((item) => item.invitee_id),
    ).toEqual([invite.inviteeId]);
  });

  it("lets no one claim an address by signing up with a password (confirm email is on)", async () => {
    const victim = `victim-${crypto.randomUUID()}@example.test`;
    const contact = await seedContact(clubA.id, victim);
    await seedInviteFor(clubA.id, contact, { starts_at: hoursFromNow(5) });
    const client = anonClient();
    const { data, error } = await client.auth.signUp({
      email: victim,
      password: crypto.randomUUID(),
    });
    expect(error).toBeNull();
    expect(data.session).toBeNull();
    expect(data.user?.email_confirmed_at ?? null).toBeNull();
  });

  it("matches nothing while the account's email is not confirmed", async () => {
    const pending = await createTestUser();
    const contact = await seedContact(clubA.id, pending.email);
    const invite = await seedInviteFor(clubA.id, contact, {
      starts_at: hoursFromNow(5),
    });
    runLocalSql(
      `update auth.users set email_confirmed_at = null where id = '${pending.id}'`,
    );
    expect((await invitesOf(pending)).items).toEqual([]);
    await expectAppError(
      pending.client.rpc("my_invite", { p_invitee: invite.inviteeId } as never),
      "not_found",
    );
  });

  it("moves invites with the contact when an organizer corrects the email", async () => {
    const contact = await seedContact(
      clubB.id,
      `typo-${crypto.randomUUID()}@example.test`,
    );
    const invite = await seedInviteFor(clubB.id, contact, {
      starts_at: hoursFromNow(6),
    });
    expect(
      (await invitesOf(other)).items.map((item) => item.invitee_id),
    ).not.toContain(invite.inviteeId);
    const { error } = await adminClient()
      .from("contacts")
      .update({ email: other.email })
      .eq("id", contact);
    expect(error).toBeNull();
    expect(
      (await invitesOf(other)).items.map((item) => item.invitee_id),
    ).toContain(invite.inviteeId);
  });
});

describe("my_invites", () => {
  let person: TestUser;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    person = await createTestUser();
    const contact = await seedContact(clubA.id, person.email);
    const add = async (name: string, hours: number, meeting = {}) => {
      const invite = await seedInviteFor(clubA.id, contact, {
        title: name,
        starts_at: hoursFromNow(hours),
        ...meeting,
      });
      ids[name] = invite.inviteeId;
      return invite;
    };
    await add("unanswered", 10);
    const reconfirm = await add("reconfirm", 20);
    await seedAnswer(clubA.id, reconfirm.meetingId, reconfirm.inviteeId, {
      status: "attending",
      needs_reconfirmation: true,
    });
    const answered = await add("answered", 30);
    await seedAnswer(clubA.id, answered.meetingId, answered.inviteeId, {
      status: "attending",
    });
    await add("cancelled", 40, { status: "cancelled" });
    await add("announcement", 50, { response_mode: "announcement" });
    const past = await add("past", -30);
    await seedAnswer(clubA.id, past.meetingId, past.inviteeId, {
      status: "late",
      delay_minutes: 10,
      reason: "Bus",
    });
    const { error } = await adminClient().from("attendance_marks").insert({
      invitee_id: past.inviteeId,
      workspace_id: clubA.id,
      meeting_id: past.meetingId,
      actual: "late",
      late_minutes: 15,
    });
    expect(error).toBeNull();
  });

  it("flags what needs an answer and counts it", async () => {
    const page = await invitesOf(person);
    expect(page.needs_count).toBe(2);
    expect(
      Object.fromEntries(
        page.items.map((item) => [item.title, item.needs_answer]),
      ),
    ).toEqual({
      unanswered: true,
      reconfirm: true,
      answered: false,
      cancelled: false,
      announcement: false,
    });
    const needs = await invitesOf(person, { filter: "needs" });
    expect(needs.items.map((item) => item.title)).toEqual([
      "unanswered",
      "reconfirm",
    ]);
  });

  it("shows past invites newest first with the answer and the check-in", async () => {
    const page = await invitesOf(person, { tab: "past" });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].answer).toMatchObject({
      status: "late",
      reason: "Bus",
    });
    expect(page.items[0].mark).toEqual({ actual: "late", late_minutes: 15 });
  });

  it("pages by start then id, with no duplicate when a later invite arrives between pages", async () => {
    const first = await invitesOf(person, { limit: 2 });
    expect(first.has_more).toBe(true);
    const last = first.items[1];
    const contact = await seedContact(clubB.id, person.email);
    const late = await seedInviteFor(clubB.id, contact, {
      title: "added later",
      starts_at: hoursFromNow(60),
    });
    const rest = await invitesOf(person, {
      after: [last.starts_at, last.invitee_id],
    });
    const all = [...first.items, ...rest.items].map((item) => item.invitee_id);
    expect(new Set(all).size).toBe(all.length);
    expect(all.at(-1)).toBe(late.inviteeId);
  });

  it("refuses bad arguments", async () => {
    await expectAppError(
      person.client.rpc("my_invites", {
        p_tab: "past",
        p_filter: "needs",
        p_after_starts: null,
        p_after_invitee: null,
        p_limit: 10,
      } as never),
      "invalid_input",
    );
    await expectAppError(
      person.client.rpc("my_invites", {
        p_tab: "upcoming",
        p_filter: "all",
        p_after_starts: hoursFromNow(1),
        p_after_invitee: null,
        p_limit: 10,
      } as never),
      "invalid_input",
    );
  });

  it("my_invite returns only the caller's own invite and is rate limited", async () => {
    const { data } = await person.client.rpc("my_invite", {
      p_invitee: ids.unanswered,
    } as never);
    expect(data).toBe(ids.unanswered);
    await expectAppError(
      other.client.rpc("my_invite", { p_invitee: ids.unanswered } as never),
      "not_found",
    );
    const restore = overrideLimit("invite_links_per_user_per_hour", 1);
    try {
      await expectAppError(
        person.client.rpc("my_invite", { p_invitee: ids.unanswered } as never),
        "rate_limited",
      );
    } finally {
      restore();
    }
  });

  it("my_answers returns every invite newest first with the full answer", async () => {
    const { data, error } = await person.client.rpc("my_answers", {
      p_after_starts: null,
      p_after_invitee: null,
      p_limit: 100,
    } as never);
    expect(error).toBeNull();
    const parsed = z
      .object({
        has_more: z.boolean(),
        items: z.array(
          z.object({
            title: z.string(),
            starts_at: z.string(),
            answer: z
              .object({
                comment: z.string(),
                after_deadline: z.boolean(),
                updated_at: z.string(),
              })
              .nullable(),
          }),
        ),
      })
      .parse(data);
    const starts = parsed.items.map((item) => item.starts_at);
    expect(starts).toEqual([...starts].sort().reverse());
    expect(parsed.items.map((item) => item.title)).toContain("past");
  });

  it("my_account names owned workspaces and counts answers with words", async () => {
    const { data } = await organizer.client.rpc("my_account");
    expect(
      z
        .object({
          owned: z.array(z.object({ name: z.string(), slug: z.string() })),
          workspaces: z.number(),
        })
        .parse(data),
    ).toMatchObject({ workspaces: 2 });
    const mine = z
      .object({
        owned: z.array(z.object({ name: z.string() })),
        workspaces: z.number(),
        answers_with_text: z.number(),
      })
      .parse((await person.client.rpc("my_account")).data);
    expect(mine).toEqual({ owned: [], workspaces: 0, answers_with_text: 1 });
  });
});

describe("token_viewer (answer page, spec §10)", () => {
  it("says owner only for the invite's own verified account, and is service-role only", async () => {
    const viewer = await createTestUser();
    const contact = await seedContact(clubA.id, viewer.email);
    const { inviteeId } = await seedInviteFor(clubA.id, contact, {
      starts_at: hoursFromNow(3),
    });
    const [{ hash }] = queryLocalSql(
      `select token_hash as hash from public.meeting_invitees where id = '${inviteeId}'`,
      z.array(z.object({ hash: z.string() })).length(1),
    );
    const admin = adminClient();
    expect(
      (
        await admin.rpc("token_viewer", {
          p_token_hash: hash,
          p_user: viewer.id,
        } as never)
      ).data,
    ).toBe("owner");
    expect(
      (
        await admin.rpc("token_viewer", {
          p_token_hash: hash,
          p_user: other.id,
        } as never)
      ).data,
    ).toBe("other");
    const denied = await viewer.client.rpc("token_viewer", {
      p_token_hash: hash,
      p_user: viewer.id,
    } as never);
    expect(denied.error).not.toBeNull();
  });
});

describe("schema", () => {
  it("drops contacts.user_id and indexes contacts by email", () => {
    const columns = queryLocalSql(
      "select column_name as name from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name = 'user_id'",
      z.array(z.object({ name: z.string() })),
    );
    expect(columns).toEqual([]);
    const indexes = queryLocalSql(
      "select indexname as name from pg_catalog.pg_indexes where schemaname = 'public' and indexname = 'contacts_email_idx'",
      z.array(z.object({ name: z.string() })),
    );
    expect(indexes).toHaveLength(1);
  });
});

describe("plans at volume (3 workspaces × 2,000 contacts, 60 meetings each)", () => {
  it("reaches the person's invites through the email and contact indexes, stale or fresh stats", async () => {
    const owner = await createTestUser();
    const person = await createTestUser();
    for (const name of ["Vol A", "Vol B", "Vol C"]) {
      const workspace = await createWorkspaceAs(owner, name);
      await seedContacts(workspace.id, 1_999, `vol-${workspace.slug}`);
      const contact = await seedContact(workspace.id, person.email);
      for (let n = 0; n < 60; n += 1) {
        await seedInviteFor(workspace.id, contact, {
          starts_at: hoursFromNow(n * 24 - 600),
        });
      }
    }
    const expectIndexed = () => {
      for (const call of [
        "public.my_invites('upcoming', 'all', null, null, 50)",
        "public.my_answers(null, null, 100)",
      ]) {
        const plan = explainCall(call, person.id, "authenticated", [
          "enable_seqscan = off",
        ]);
        expect(planUsesIndex(plan, "contacts_email_idx"), call).toBe(true);
        expect(
          planUsesIndex(plan, "meeting_invitees_contact_ws_idx"),
          call,
        ).toBe(true);
      }
    };
    expectIndexed();
    for (const table of ["contacts", "meeting_invitees", "meetings"]) {
      runLocalSql(`analyze public.${table}`);
    }
    expectIndexed();
  });
});
