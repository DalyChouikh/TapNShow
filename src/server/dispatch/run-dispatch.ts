import "server-only";
import { REFRESH_FAILURE_DEFER_MS, THROTTLE_DEFER_MS } from "@/config/meetings";
import { renderMeetingInviteEmail } from "@/emails/meeting-invite-email";
import { logger } from "@/lib/logger";
import { inviteeTokenHash } from "@/server/crypto/invitee-token";
import type { GmailSendResult } from "@/server/gmail/gmail-client";
import { buildMeetingMime, newMessageId } from "@/server/gmail/mime";
import type { RefreshResult } from "@/server/google/gmail-oauth";
import type {
  BrokenAlert,
  Claim,
  ClaimedJob,
  DispatchStore,
} from "@/server/queries/dispatch";

/** Everything the dispatcher touches, injected so tests run without Google or a database. */
export type DispatchDeps = {
  store: DispatchStore;
  gmail: (input: {
    accessToken: string;
    raw: string;
    threadId: string | null;
  }) => Promise<GmailSendResult>;
  refresh: (refreshToken: string) => Promise<RefreshResult>;
  openToken: (sealed: string, userId: string, googleSub: string) => string;
  tokenFor: (inviteeId: string) => string;
  appUrl: string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  alertBroken: (alert: BrokenAlert[]) => Promise<void>;
  newRunId: () => string;
};

/** Tuning for one run (values from `src/config/meetings.ts` in production). */
export type DispatchOptions = {
  budgetMs: number;
  paceMs: number;
  batchSize: number;
  leaseSeconds: number;
};

/** What one run did (logged; returned for tests). */
export type DispatchSummary = {
  senders: number;
  sent: number;
  failed: number;
  skipped: number;
  unknown: number;
  deferred: number;
};

type Thread = { threadId: string; rootMessageId: string };
type Session = {
  claim: Claim;
  accessToken: string;
  threads: Map<string, Thread>;
};
type JobOutcome = "continue" | "stop";

/** Drains due jobs sender by sender within the time budget (spec §8). */
export async function runDispatch(
  deps: DispatchDeps,
  options: DispatchOptions,
): Promise<DispatchSummary> {
  const run = deps.newRunId();
  const started = deps.now();
  const summary: DispatchSummary = {
    senders: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    unknown: 0,
    deferred: 0,
  };
  const outOfTime = () => deps.now() - started >= options.budgetMs;
  try {
    while (!outOfTime()) {
      const claim = await deps.store.claim(
        run,
        options.batchSize,
        options.leaseSeconds,
      );
      if (!claim) {
        break;
      }
      summary.senders += 1;
      await drainSender(deps, options, run, claim, summary, outOfTime);
    }
  } finally {
    await deps.store.release(run);
  }
  logger.info({ summary }, "dispatch run finished");
  return summary;
}

async function breakSender(
  deps: DispatchDeps,
  run: string,
  claim: Claim,
  reason: string,
): Promise<void> {
  const result = await deps.store.markBroken(run, claim.connection.id, reason);
  if (result.alert.length > 0) {
    await deps
      .alertBroken(result.alert)
      .catch((error: Error) =>
        logger.error({ err: error }, "sender-broken alert failed"),
      );
  }
}

async function drainSender(
  deps: DispatchDeps,
  options: DispatchOptions,
  run: string,
  claim: Claim,
  summary: DispatchSummary,
  outOfTime: () => boolean,
): Promise<void> {
  let refreshToken: string;
  try {
    refreshToken = deps.openToken(
      claim.connection.refreshTokenEncrypted,
      claim.connection.userId,
      claim.connection.googleSub,
    );
  } catch (error) {
    logger.error({ err: error }, "stored refresh token cannot be opened");
    await breakSender(deps, run, claim, "token_unreadable");
    return;
  }
  const refreshed = await deps.refresh(refreshToken);
  if (refreshed.kind === "invalid_grant") {
    await breakSender(deps, run, claim, "invalid_grant");
    return;
  }
  if (refreshed.kind === "error") {
    await deps.store.deferSender(
      run,
      claim.connection.id,
      new Date(deps.now() + REFRESH_FAILURE_DEFER_MS),
      "token_refresh_failed",
    );
    return;
  }
  const session: Session = {
    claim,
    accessToken: refreshed.accessToken,
    threads: new Map(
      claim.jobs
        .filter((job) => job.meeting.threadId && job.meeting.rootMessageId)
        .map((job) => [
          job.meeting.id,
          {
            threadId: job.meeting.threadId ?? "",
            rootMessageId: job.meeting.rootMessageId ?? "",
          },
        ]),
    ),
  };
  const queue = [...claim.jobs];
  while (queue.length > 0) {
    if (outOfTime()) {
      await deps.store.unclaim(queue.map((job) => job.jobId));
      return;
    }
    const job = queue.shift() as ClaimedJob;
    const reservation = await deps.store.reserve(job.jobId);
    if (reservation.kind === "done") {
      summary.skipped += 1;
      continue;
    }
    if (reservation.kind === "gone") {
      continue;
    }
    if (reservation.kind === "quota") {
      summary.deferred += 1;
      await deps.store.unclaim(queue.map((next) => next.jobId));
      return;
    }
    const outcome = await sendJob(deps, run, session, job, summary);
    if (outcome === "stop") {
      return;
    }
    await deps.sleep(options.paceMs);
  }
}

async function sendJob(
  deps: DispatchDeps,
  run: string,
  session: Session,
  job: ClaimedJob,
  summary: DispatchSummary,
): Promise<JobOutcome> {
  const token = deps.tokenFor(job.inviteeId);
  const email = await renderMeetingInviteEmail({
    workspaceName: job.workspaceName,
    recipientName: job.contact.fullName,
    senderEmail: session.claim.connection.googleEmail,
    meeting: job.meeting,
    links: {
      respond: `${deps.appUrl}/r/${token}`,
      unsubscribe: `${deps.appUrl}/u/${token}`,
      report: `${deps.appUrl}/report/${token}`,
    },
  });
  const attempt = async (thread: Thread | undefined) => {
    const messageId = newMessageId(deps.appUrl);
    const raw = await buildMeetingMime({
      from: {
        name: job.workspaceName,
        address: session.claim.connection.googleEmail,
      },
      to: { name: job.contact.fullName, address: job.contact.email },
      subject: email.subject,
      html: email.html,
      text: email.text,
      messageId,
      inReplyTo: thread?.rootMessageId ?? null,
      listUnsubscribeUrl: `${deps.appUrl}/api/r/${token}/unsubscribe`,
    });
    return {
      messageId,
      result: await deps.gmail({
        accessToken: session.accessToken,
        raw,
        threadId: thread?.threadId ?? null,
      }),
    };
  };

  let thread = session.threads.get(job.meeting.id);
  let { messageId, result } = await attempt(thread);
  if (result.kind === "auth") {
    const again = await deps.refresh(
      deps.openToken(
        session.claim.connection.refreshTokenEncrypted,
        session.claim.connection.userId,
        session.claim.connection.googleSub,
      ),
    );
    if (again.kind !== "ok") {
      await deps.store.unclaim([job.jobId]);
      await breakSender(
        deps,
        run,
        session.claim,
        again.kind === "invalid_grant"
          ? "invalid_grant"
          : "token_refresh_failed",
      );
      return "stop";
    }
    session.accessToken = again.accessToken;
    ({ messageId, result } = await attempt(thread));
  }
  if (result.kind === "thread_missing" && thread) {
    session.threads.delete(job.meeting.id);
    thread = undefined;
    ({ messageId, result } = await attempt(thread));
  }

  switch (result.kind) {
    case "sent":
      if (!thread) {
        session.threads.set(job.meeting.id, {
          threadId: result.threadId,
          rootMessageId: messageId,
        });
        await deps.store.setThread(
          job.meeting.id,
          session.claim.connection.id,
          result.threadId,
          messageId,
        );
      }
      await deps.store.finish(job.jobId, "sent", null, inviteeTokenHash(token));
      summary.sent += 1;
      return "continue";
    case "invalid_recipient":
      await deps.store.finish(job.jobId, "failed", result.reason, null);
      summary.failed += 1;
      return "continue";
    case "thread_missing":
      await deps.store.retry(job.jobId, "thread_missing");
      return "continue";
    case "retry":
      await deps.store.retry(job.jobId, `http_${result.status}`);
      return "continue";
    case "unknown":
      await deps.store.finish(job.jobId, "unknown", "delivery_unknown", null);
      summary.unknown += 1;
      return "continue";
    case "throttled":
      await deps.store.deferSender(
        run,
        session.claim.connection.id,
        new Date(deps.now() + THROTTLE_DEFER_MS),
        "gmail_throttled",
      );
      summary.deferred += 1;
      return "stop";
    case "forbidden":
    case "auth":
      await breakSender(
        deps,
        run,
        session.claim,
        result.kind === "forbidden" ? result.reason : "auth",
      );
      return "stop";
  }
}
