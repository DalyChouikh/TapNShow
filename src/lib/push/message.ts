import { createTranslator } from "next-intl";
import type { Locale } from "@/config/i18n";
import {
  PUSH_CANCEL_TTL_SECONDS,
  PUSH_TEXT_MAX,
  PUSH_TTL_MAX_SECONDS,
  PUSH_TTL_MIN_SECONDS,
} from "@/config/push";
import { formatDeadline, formatTime } from "@/lib/meetings/format";
import type { PushItem } from "@/shared/api/push";
import messages from "../../../messages/en.json";

/** What a notification shows and opens (the service worker displays exactly this). */
export type PushMessage = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

/** The `Notifications` translator of one locale. */
export type PushWords = ReturnType<
  typeof createTranslator<typeof messages, "Notifications">
>;

/** The notification words of a workspace's locale (built once per locale per run). */
export function pushWords(locale: Locale): PushWords {
  return createTranslator({ locale, messages, namespace: "Notifications" });
}

const clip = (text: string) =>
  text.length > PUSH_TEXT_MAX ? `${text.slice(0, PUSH_TEXT_MAX - 1)}…` : text;

function placeOf(item: PushItem): string {
  return item.locationMode === "online" ? item.onlineText : item.locationText;
}

/**
 * The one builder of a notification (spec §7.4): "<Workspace> · <Meeting>" and one line per
 * event. Never an answer, a reason, another person or a personal link; it opens `/invites/<id>`.
 */
export function pushMessage(item: PushItem, t: PushWords): PushMessage {
  const when = formatDeadline(item.startsAt, item.timezone);
  const place = placeOf(item) || "none";
  const body = (() => {
    switch (item.kind) {
      case "invite":
        return item.responseMode === "announcement"
          ? t("inviteAnnouncement", { when })
          : t("invite", { when });
      case "update":
        return item.answered && item.needsReconfirmation
          ? t("timeChanged", { when })
          : t("changed", { when, place });
      case "cancel":
        return t("cancelled");
      case "reminder":
        return item.audience === "going"
          ? t("startsSoon", {
              time: formatTime(item.startsAt, item.timezone),
              place,
            })
          : t("pleaseAnswer", { when });
    }
  })();
  return {
    title: clip(`${item.workspaceName} · ${item.title}`),
    body: clip(body),
    url: `/invites/${item.inviteeId}`,
    tag: `${item.kind}:${item.inviteeId}`,
  };
}

/** How long a push service keeps it for an offline phone: until the start, a day for a cancellation. */
export function pushTtlSeconds(item: PushItem, nowMs: number): number {
  if (item.kind === "cancel") {
    return PUSH_CANCEL_TTL_SECONDS;
  }
  const left = Math.floor((Date.parse(item.startsAt) - nowMs) / 1000);
  return Math.min(PUSH_TTL_MAX_SECONDS, Math.max(PUSH_TTL_MIN_SECONDS, left));
}

/** "Starts soon" reminders wake the phone; everything else waits for a good moment. */
export function pushUrgency(item: PushItem): "high" | "normal" {
  return item.kind === "reminder" && item.audience === "going"
    ? "high"
    : "normal";
}
