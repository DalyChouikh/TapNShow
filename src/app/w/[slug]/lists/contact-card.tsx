"use client";

import { CaretRight } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { Contact, ListSummary } from "@/shared/api/roster";
import { ListTag } from "@/components/forms/list-tag";

const CARD =
  "flex w-full min-w-0 items-center gap-3 rounded-card border-[length:var(--tn-border-width)] border-outline bg-surface p-3 text-left shadow-brutal-sm";

/** Name, email and list pills, shared by both card variants. */
function CardBody({
  contact,
  lists,
  selected = false,
}: {
  contact: Contact;
  lists: ListSummary[];
  selected?: boolean;
}) {
  const own = lists.filter((list) => contact.listIds.includes(list.id));
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="font-bold break-words">{contact.fullName}</span>
      <span
        className={cn(
          "text-sm break-all",
          selected ? "text-on-fill" : "text-muted-ink",
        )}
      >
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
  );
}

/**
 * One person on a phone: name, email, list pills. Normally the whole card opens the editor sheet;
 * in Select mode (`selection`) it is a checkbox row instead. Long names wrap and long emails break
 * anywhere, so a 320 px screen never scrolls sideways.
 */
export function ContactCard({
  contact,
  lists,
  onOpen,
  selection,
}: {
  contact: Contact;
  lists: ListSummary[];
  onOpen: (contact: Contact) => void;
  selection?: { selected: boolean; onToggle: () => void };
}) {
  const t = useTranslations("Lists");
  if (selection) {
    return (
      <label
        className={`${CARD} cursor-pointer has-[[data-state=checked]]:bg-fill-primary has-[[data-state=checked]]:text-on-fill`}
      >
        <Checkbox
          checked={selection.selected}
          onCheckedChange={selection.onToggle}
          aria-label={t("selectPerson", { name: contact.fullName })}
        />
        <CardBody
          contact={contact}
          lists={lists}
          selected={selection.selected}
        />
      </label>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(contact)}
      className={`${CARD} transition-transform duration-300 ease-spring active:translate-y-0.5 active:shadow-none motion-reduce:transition-none`}
    >
      <CardBody contact={contact} lists={lists} />
      <CaretRight
        weight="bold"
        aria-hidden
        className="shrink-0 text-muted-ink"
      />
    </button>
  );
}
