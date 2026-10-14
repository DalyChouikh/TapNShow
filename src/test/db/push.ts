import { adminClient } from "./clients";
import { runLocalSql } from "./sql";

/** A subscription as the browser would send it (base64url keys of the right lengths). */
export function fakeSubscription(n = crypto.randomUUID()) {
  return {
    endpoint: `https://push.example.test/send/${n}`,
    p256dh: `B${"A".repeat(86)}`,
    auth: "A".repeat(22),
  };
}

/** An outbox job leased by a run, as `dispatch_claim` would leave it (service role). */
export async function processingJob(
  workspaceId: string,
  meetingId: string,
  inviteeId: string,
  kind: "invite" | "calendar_confirm" | "update" | "cancel" | "reminder",
  payload: Record<string, string | number | boolean> = {},
): Promise<string> {
  const { data, error } = await adminClient()
    .from("outbox_jobs")
    .insert({
      kind,
      workspace_id: workspaceId,
      meeting_id: meetingId,
      invitee_id: inviteeId,
      payload,
      idempotency_key: `test:${kind}:${crypto.randomUUID()}`,
      status: "processing",
      locked_until: new Date(Date.now() + 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return data.id;
}

/**
 * Lets the fake push host (`push.example.test`) subscribe, as e2e does for its local push service.
 * Real deployments list only the browsers' push services (`private.push_service_hosts`).
 */
export function allowFakePushHost(): void {
  runLocalSql(
    "insert into private.push_service_hosts (host, include_subdomains) values ('push.example.test', false) on conflict do nothing",
  );
}
