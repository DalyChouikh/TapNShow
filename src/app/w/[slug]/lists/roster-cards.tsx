"use client";

import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ROSTER_CARD_ESTIMATE_PX } from "@/config/roster";
import type { Contact, ListSummary } from "@/shared/api/roster";
import { ContactCard } from "./contact-card";

const OVERSCAN = 6;

/**
 * Phone roster: only the cards near the viewport are in the DOM (up to 2,000 people). The list's
 * element is kept in state (callback ref) so its page offset can be read during render.
 */
export function RosterCards({
  contacts,
  lists,
  onOpen,
  selection,
}: {
  contacts: Contact[];
  lists: ListSummary[];
  onOpen: (contact: Contact) => void;
  /** Select mode: cards become checkbox rows. */
  selection?: {
    selectedIds: ReadonlySet<string>;
    onToggle: (contactId: string) => void;
  };
}) {
  const t = useTranslations("Lists");
  const [listElement, setListElement] = useState<HTMLUListElement | null>(null);
  const scrollMargin = listElement?.offsetTop ?? 0;
  const virtualizer = useWindowVirtualizer({
    count: contacts.length,
    estimateSize: () => ROSTER_CARD_ESTIMATE_PX,
    overscan: OVERSCAN,
    scrollMargin,
    getItemKey: (index) => contacts[index].id,
  });
  return (
    <ul
      ref={setListElement}
      aria-label={t("peopleLabel")}
      className="relative"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const contact = contacts[item.index];
        return (
          <li
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            aria-label={`${contact.fullName}, ${contact.email}`}
            aria-setsize={contacts.length}
            aria-posinset={item.index + 1}
            className="absolute top-0 left-0 w-full pb-3"
            style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
          >
            <ContactCard
              contact={contact}
              lists={lists}
              onOpen={onOpen}
              selection={
                selection
                  ? {
                      selected: selection.selectedIds.has(contact.id),
                      onToggle: () => selection.onToggle(contact.id),
                    }
                  : undefined
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
