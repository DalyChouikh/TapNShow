"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ShowMore } from "@/components/ui/show-more";
import { Skeleton } from "@/components/ui/skeleton";
import { PEOPLE_SEARCH_MAX, SEARCH_DEBOUNCE_MS } from "@/config/meetings";
import { useMarkAttendance, useMarkRest } from "@/hooks/use-check-in";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useMeetingPeople } from "@/hooks/use-results";
import type { Meeting } from "@/shared/api/meetings";
import type { Mark, MeetingResults } from "@/shared/api/responses";
import { CheckInRow } from "./check-in-row";

/**
 * Check-in at the door (spec §7.8): a count, a search, everyone invited with Present / Late /
 * Absent, and "Mark the rest as they said" behind an "Are you sure?" (no count on the button, owner
 * decision 2026-10-09).
 */
export function CheckInList({
  slug,
  meeting,
  results,
  live,
}: {
  slug: string;
  meeting: Meeting;
  results: MeetingResults;
  /** Refresh the list while the meeting is near (the page's `isLive`), not days later. */
  live: boolean;
}) {
  const t = useTranslations("MeetingPage.checkIn");
  const [search, setSearch] = useState("");
  const settled = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const people = useMeetingPeople(
    slug,
    meeting.id,
    "all",
    live,
    settled || null,
  );
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const mark = useMarkAttendance(slug, meeting.id, (inviteeId) =>
    setFailed((current) => new Set(current).add(inviteeId)),
  );
  const rest = useMarkRest(slug, meeting.id);
  const [confirming, setConfirming] = useState(false);
  const onMark = (inviteeId: string, actual: Mark["actual"] | null) => {
    setFailed((current) => {
      const next = new Set(current);
      next.delete(inviteeId);
      return next;
    });
    mark.mutate({ inviteeId, actual });
  };
  return (
    <Card as="section" className="flex flex-col gap-3">
      <p className="font-bold">
        {t("count", { done: results.checkedIn, total: results.emails.total })}
      </p>
      <Input
        id="check-in-search"
        label={t("search")}
        type="search"
        maxLength={PEOPLE_SEARCH_MAX}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {people.query.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <ul>
          {people.items.map((person) => (
            <CheckInRow
              key={person.inviteeId}
              slug={slug}
              person={person}
              failed={failed.has(person.inviteeId)}
              onMark={(actual) => onMark(person.inviteeId, actual)}
            />
          ))}
        </ul>
      )}
      <ShowMore
        hasMore={people.hasMore}
        loading={people.isLoadingMore}
        onMore={people.loadMore}
      />
      <Button className="justify-center" onClick={() => setConfirming(true)}>
        {t("rest")}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("restTitle")}
        description={t("restBody")}
        confirmLabel={t("restConfirm")}
        pending={rest.isPending}
        onConfirm={() =>
          rest.mutate(undefined, {
            onSuccess: ({ marked }) => {
              setConfirming(false);
              toast.success(t("restDone", { count: marked }));
            },
            onError: () => setConfirming(false),
          })
        }
      />
    </Card>
  );
}
