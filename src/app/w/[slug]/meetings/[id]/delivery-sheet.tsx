"use client";

import { useTranslations } from "next-intl";
import { ShowMore } from "@/components/ui/show-more";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMeetingPeople } from "@/hooks/use-results";
import { cn } from "@/lib/utils";
import type { PersonRow } from "@/shared/api/responses";

const PILL: Record<PersonRow["emailStatus"], string> = {
  sent: "bg-fill-success",
  queued: "bg-fill-neutral",
  skipped: "bg-fill-neutral",
  failed: "bg-fill-danger",
  unknown: "bg-fill-warning",
};

const KNOWN_REASONS = [
  "unsubscribed",
  "meeting_cancelled",
  "meeting_started",
  "delivery_unknown",
] as const;

/** Maps a stored delivery error to a reason key (Gmail's own messages read as "refused"). */
function reasonKey(
  error: string | null,
): (typeof KNOWN_REASONS)[number] | "other" {
  return KNOWN_REASONS.find((reason) => reason === error) ?? "other";
}

/** Everyone's email delivery (the M4 list, now behind the email line), paged. */
export function DeliverySheet({
  slug,
  meetingId,
  open,
  onOpenChange,
}: {
  slug: string;
  meetingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("MeetingPage");
  const people = useMeetingPeople(slug, meetingId, "all", false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("results.deliveryTitle")}</DialogTitle>
        </DialogHeader>
        <ul>
          {people.items.map((person) => (
            <li
              key={person.inviteeId}
              className="flex items-center gap-3 border-b border-dashed border-outline/30 py-2 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-bold break-words">{person.fullName}</span>
                <span className="truncate text-sm text-muted-ink">
                  {person.email}
                </span>
                {person.emailStatus === "failed" ||
                person.emailStatus === "unknown" ||
                person.emailStatus === "skipped" ? (
                  <span className="text-sm">
                    {t(`reason.${reasonKey(person.emailError)}`)}
                  </span>
                ) : null}
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full border-2 border-outline px-2 text-xs font-bold text-on-fill",
                  PILL[person.emailStatus],
                )}
              >
                {t(`status.${person.emailStatus}`)}
              </span>
            </li>
          ))}
        </ul>
        <ShowMore
          hasMore={people.hasMore}
          loading={people.isLoadingMore}
          onMore={people.loadMore}
        />
      </DialogContent>
    </Dialog>
  );
}
