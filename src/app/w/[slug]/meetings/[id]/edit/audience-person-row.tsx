"use client";

import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { ListTag } from "@/components/forms/list-tag";
import type { AudiencePerson } from "@/shared/api/meetings";
import type { ListSummary } from "@/shared/api/roster";

/** One person in the Audience step: tick = invited; marks explain why someone cannot be ticked. */
export function AudiencePersonRow({
  person,
  lists,
  onToggle,
}: {
  person: AudiencePerson;
  lists: ListSummary[];
  onToggle: (included: boolean) => void;
}) {
  const t = useTranslations("Wizard.audience");
  const mark = person.invited
    ? t("markInvited")
    : person.reported
      ? t("markReported")
      : person.unsubscribed
        ? t("markUnsubscribed")
        : null;
  const locked = person.invited || person.unsubscribed;
  return (
    <li className="flex items-center gap-2 border-b border-dashed border-outline/30 py-1 last:border-b-0">
      <Checkbox
        aria-label={t("include", { name: person.fullName })}
        checked={person.invited || (!person.excluded && !person.unsubscribed)}
        disabled={locked}
        onCheckedChange={(checked) => onToggle(checked === true)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={
            person.excluded
              ? "font-bold break-words text-muted-ink line-through"
              : "font-bold break-words"
          }
        >
          {person.fullName}
        </span>
        <span className="truncate text-sm text-muted-ink">{person.email}</span>
      </div>
      <div className="flex max-w-[40%] shrink-0 flex-col items-end gap-1">
        {mark ? (
          <span className="text-xs font-bold text-muted-ink">{mark}</span>
        ) : null}
        {person.listIds.slice(0, 2).map((id) => {
          const list = lists.find((l) => l.id === id);
          return list ? <ListTag key={id} list={list} /> : null;
        })}
      </div>
    </li>
  );
}
