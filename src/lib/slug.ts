/** Suffix alphabet without look-alikes (l, o, 0, 1); 32 symbols, so one byte maps without bias. */
const SUFFIX_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** Random characters appended to every workspace slug (spec §4). */
export const SLUG_SUFFIX_LENGTH = 4;

/** Longest readable part of a slug. */
export const SLUG_BASE_MAX_LENGTH = 40;

/** Used when a name has no Latin letters or digits (e.g. Arabic or emoji-only names). */
export const SLUG_FALLBACK_BASE = "workspace";

/** Readable part of a slug: accents removed, lower-case ASCII words joined by dashes. */
export function slugBase(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_BASE_MAX_LENGTH)
    .replace(/-+$/g, "");
  return base || SLUG_FALLBACK_BASE;
}

/** `<base>-<suffix>`; fixed at creation, never changes when the workspace is renamed. */
export function generateWorkspaceSlug(
  name: string,
  randomBytes: (length: number) => Uint8Array = (length) =>
    crypto.getRandomValues(new Uint8Array(length)),
): string {
  const suffix = Array.from(
    randomBytes(SLUG_SUFFIX_LENGTH),
    (byte) => SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length],
  ).join("");
  return `${slugBase(name)}-${suffix}`;
}
