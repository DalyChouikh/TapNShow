"use client";

import { CaretRight } from "@phosphor-icons/react";
import type { Contact, ListSummary } from "@/shared/api/roster";
import { ListTag } from "./list-tag";

/**
 * One person on a phone: name, email, list pills; the whole card opens the editor sheet. Long
 * names wrap and long emails break anywhere, so a 320 px screen never scrolls sideways.
 */
export function ContactCard({
  contact,
  lists,
  onOpen,
}: {
  contact: Contact;
  lists: ListSummary[];
  onOpen: (contact: Contact) => void;
}) {
  const own = lists.filter((list) => contact.listIds.includes(list.id));
  return (
    <button
      type="button"
      onClick={() => onOpen(contact)}
      className="flex w-full min-w-0 items-center gap-3 rounded-card border-[length:var(--tn-border-width)] border-outline bg-surface p-3 text-left shadow-brutal-sm transition-transform duration-300 ease-spring active:translate-y-0.5 active:shadow-none motion-reduce:transition-none"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-bold break-words">{contact.fullName}</span>
        <span className="text-sm break-all text-muted-ink">
          {contact.email}
        </span>
        {own.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {own.map((list) => (
              <ListTag key={list.id} list={list} />
            ))}
          </span>
        ) : null}
      </span>
      <CaretRight
        weight="bold"
        aria-hidden
        className="shrink-0 text-muted-ink"
      />
    </button>
  );
}
