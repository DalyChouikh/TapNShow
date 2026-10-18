import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { REMINDER_AUDIENCES } from "@/config/reminders";
import { reminderDueAt } from "@/lib/meetings/reminders";
import { createTestUser } from "@/test/db/clients";
import { hoursFromNow, seedMeeting } from "@/test/db/meetings";
import { queryLocalSql } from "@/test/db/sql";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

let workspace: TestWorkspace;

beforeAll(async () => {
  const owner = await createTestUser();
  workspace = await createWorkspaceAs(owner, "Robotics Club");
});

type Case = {
  name: string;
  startsAt: string;
  responseDeadline: string | null;
  responseMode: "attendance" | "rsvp" | "announcement";
  reminderPendingHours: number | null;
  reminderGoingHours: number | null;
};

const starts = hoursFromNow(30);
const CASES: Case[] = [
  {
    name: "a deadline",
    startsAt: starts,
    responseDeadline: hoursFromNow(20),
    responseMode: "attendance",
    reminderPendingHours: 24,
    reminderGoingHours: 2,
  },
  {
    name: "no deadline",
    startsAt: starts,
    responseDeadline: null,
    responseMode: "rsvp",
    reminderPendingHours: 6,
    reminderGoingHours: 24,
  },
  {
    name: "both reminders off",
    startsAt: starts,
    responseDeadline: null,
    responseMode: "attendance",
    reminderPendingHours: null,
    reminderGoingHours: null,
  },
  {
    name: "an announcement",
    startsAt: starts,
    responseDeadline: null,
    responseMode: "announcement",
    reminderPendingHours: null,
    reminderGoingHours: null,
  },
];

describe("reminderDueAt, the twin of private.reminder_due for a sent meeting", () => {
  it.each(CASES.map((c) => [c.name, c] as const))(
    "agrees for %s",
    async (_, c) => {
      const id = await seedMeeting(workspace.id, {
        status: "scheduled",
        starts_at: c.startsAt,
        response_deadline: c.responseDeadline,
        response_mode: c.responseMode,
        reminder_pending_hours: c.reminderPendingHours,
        reminder_going_hours: c.reminderGoingHours,
      });
      for (const audience of REMINDER_AUDIENCES) {
        const [row] = queryLocalSql(
          `select (extract(epoch from private.reminder_due(m, '${audience}')) * 1000)::bigint as ms
           from public.meetings m where m.id = '${id}'`,
          z.array(z.object({ ms: z.coerce.number().nullable() })).length(1),
        );
        expect(row.ms, audience).toBe(
          reminderDueAt(c, audience)?.getTime() ?? null,
        );
      }
    },
  );
});
