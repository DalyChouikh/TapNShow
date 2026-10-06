import type { Contact, ListCreated, Roster } from "@/shared/api/roster";

const byName = (a: Contact, b: Contact): number =>
  a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" }) ||
  a.email.localeCompare(b.email);

/** Recomputes every list's `contactCount` from the people's `listIds`. */
export function withListCounts(roster: Roster): Roster {
  const counts = new Map<string, number>();
  for (const contact of roster.contacts) {
    for (const listId of contact.listIds) {
      counts.set(listId, (counts.get(listId) ?? 0) + 1);
    }
  }
  return {
    ...roster,
    lists: roster.lists.map((list) => ({
      ...list,
      contactCount: counts.get(list.id) ?? 0,
    })),
  };
}

/** Optimistic edit of one person (name, email and/or lists), keeping name order and counts. */
export function patchContact(
  roster: Roster,
  contactId: string,
  patch: Partial<Pick<Contact, "fullName" | "email" | "listIds">>,
): Roster {
  const contacts = roster.contacts
    .map((contact) =>
      contact.id === contactId ? { ...contact, ...patch } : contact,
    )
    .sort(byName);
  return withListCounts({ ...roster, contacts });
}

/** Optimistic removal of people (Undo delete, bulk delete). */
export function removeContacts(
  roster: Roster,
  contactIds: readonly string[],
): Roster {
  const removed = new Set(contactIds);
  return withListCounts({
    ...roster,
    contacts: roster.contacts.filter((contact) => !removed.has(contact.id)),
  });
}

/** Adds a just-created list (no people yet) in name order. */
export function addList(roster: Roster, list: ListCreated): Roster {
  const lists = [...roster.lists, { ...list, contactCount: 0 }].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  return { ...roster, lists };
}
