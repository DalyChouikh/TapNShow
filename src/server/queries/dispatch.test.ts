import { describe, expect, it } from "vitest";
import { parseClaim } from "./dispatch";

/** One claim as `dispatch_claim` returns it (snake_case, M5 shape: no `payload`). */
function dbClaimRow(job: Record<string, string | object>) {
  return {
    connection: {
      id: "30000000-0000-4000-8000-000000000000",
      user_id: "40000000-0000-4000-8000-000000000000",
      google_sub: "g-1",
      google_email: "club@gmail.com",
      refresh_token_encrypted: "sealed",
    },
    jobs: [
      {
        job_id: "00000000-0000-4000-8000-000000000001",
        kind: "invite",
        attempts: 0,
        invitee_id: "10000000-0000-4000-8000-000000000001",
        workspace_id: "20000000-0000-4000-8000-000000000000",
        workspace_name: "GDG ISSAT",
        contact: { full_name: "Member 1", email: "m1@uni.tn" },
        meeting: {
          id: "11111111-1111-4111-8111-111111111111",
          title: "Weekly sync",
          agenda_md: "",
          starts_at: "2026-10-09T17:00:00+00:00",
          duration_minutes: 60,
          timezone: "Africa/Tunis",
          location_mode: "in_person",
          location_text: "Room B12",
          online_text: "",
          meeting_url: "",
          response_mode: "attendance",
          response_deadline: null,
          footer_note: "Bring a laptop",
          ics_uid: "meeting-1@tapnshow.vercel.app",
          thread_id: null,
          root_message_id: null,
        },
        ...job,
      },
    ],
  };
}

describe("parseClaim", () => {
  it("still parses an invite claimed before the M6 migration (no payload)", () => {
    const claim = parseClaim(dbClaimRow({ kind: "invite" }));
    expect(claim?.jobs[0].payload).toEqual({
      changes: {},
      notify: false,
      reconfirm: false,
      audience: "pending",
    });
    expect(claim?.jobs[0].meeting.footerNote).toBe("Bring a laptop");
  });

  it("reads the M6 kinds and their payload", () => {
    const claim = parseClaim(
      dbClaimRow({
        kind: "update",
        payload: {
          changes: { title: ["Sync", "Weekly sync"] },
          notify: true,
          reconfirm: false,
          calendar: { action: "request", sequence: 1 },
        },
      }),
    );
    expect(claim?.jobs[0]).toMatchObject({
      kind: "update",
      payload: { changes: { title: ["Sync", "Weekly sync"] }, notify: true },
    });
  });

  it("returns null when there is nothing to claim", () => {
    expect(parseClaim(null)).toBeNull();
  });
});
