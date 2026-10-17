import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PRODUCTION_URL } from "@/config/site";
import { createTestUser } from "@/test/db/clients";
import { seedMeeting } from "@/test/db/meetings";
import { queryLocalSql } from "@/test/db/sql";
import { createWorkspaceAs } from "@/test/db/workspaces";

describe("the site's domain in the database (2026-10-17)", () => {
  it("names the production host in a new meeting's calendar UID (twin of PRODUCTION_URL)", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "Robotics Club");
    const meetingId = await seedMeeting(workspace.id);
    const [{ ics_uid }] = queryLocalSql(
      `select ics_uid from public.meetings where id = '${meetingId}'`,
      z.array(z.object({ ics_uid: z.string() })).length(1),
    );
    expect(ics_uid).toMatch(
      new RegExp(
        `^[0-9a-f-]{36}@${new URL(PRODUCTION_URL).host.replaceAll(".", "\\.")}$`,
      ),
    );
  });
});
