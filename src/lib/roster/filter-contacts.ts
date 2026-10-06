import type { Contact } from "@/shared/api/roster";

/** Lower-case, accent-free, trimmed: "Inès " → "ines", so typing without accents still finds people. */
export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** The "No list" chip's filter value (never a list id: those are UUIDs). */
export const NO_LIST = "no-list";

/** Selected chip: a list id, `NO_LIST`, or `null` for "All". */
export type ListFilter = string | null;

const inFilter = (contact: Contact, listId: ListFilter): boolean => {
  if (listId === null) {
    return true;
  }
  return listId === NO_LIST
    ? contact.listIds.length === 0
    : contact.listIds.includes(listId);
};

/** People matching the search (name or email) and the selected list chip. */
export function filterContacts(
  contacts: Contact[],
  filter: { query: string; listId: ListFilter },
): Contact[] {
  const query = normalizeForSearch(filter.query);
  return contacts.filter(
    (contact) =>
      inFilter(contact, filter.listId) &&
      (query === "" ||
        normalizeForSearch(contact.fullName).includes(query) ||
        contact.email.includes(query)),
  );
}
