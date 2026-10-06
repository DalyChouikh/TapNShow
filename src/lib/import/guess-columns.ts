import { emailSchema } from "@/shared/api/common";
import type { ColumnMapping, ColumnTarget, SheetGrid } from "./types";

/** Rows looked at when guessing from data. */
const SAMPLE_ROWS = 20;

/** Share of sampled cells that must look like emails for a header-less column to be "Email". */
const EMAIL_SHARE_MIN = 0.5;

/** Accent-free, lower-case, punctuation as spaces: "Équipe" → "equipe", "E-mail" → "e mail". */
const normalizeHeader = (header: string): string =>
  header
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Header names (normalized) per target, English and French (spec §7.14). */
const HEADER_SYNONYMS: Record<
  Exclude<ColumnTarget, "ignore">,
  readonly string[]
> = {
  email: [
    "email",
    "e mail",
    "mail",
    "courriel",
    "adresse email",
    "adresse e mail",
    "adresse mail",
    "email address",
    "e mail address",
  ],
  fullName: [
    "full name",
    "name",
    "nom complet",
    "nom et prenom",
    "prenom et nom",
    "nom prenom",
    "prenom nom",
    "first name",
    "last name",
    "firstname",
    "lastname",
    "given name",
    "family name",
    "surname",
    "prenom",
    "nom",
  ],
  lists: [
    "team",
    "teams",
    "equipe",
    "equipes",
    "list",
    "lists",
    "liste",
    "listes",
    "department",
    "departement",
    "pole",
    "cellule",
    "group",
    "groups",
    "groupe",
    "groupes",
    "committee",
    "comite",
  ],
};

const MATCH_ORDER = ["email", "fullName", "lists"] as const;

const looksLikeEmail = (cell: string): boolean =>
  emailSchema.safeParse(cell).success;
const isBlank = (row: string[]): boolean => row.every((cell) => cell === "");

function targetForHeader(header: string): ColumnTarget {
  const key = normalizeHeader(header);
  const exact = MATCH_ORDER.find((target) =>
    HEADER_SYNONYMS[target].includes(key),
  );
  if (exact) {
    return exact;
  }
  return key.split(" ").includes("mail") || key.includes("email")
    ? "email"
    : "ignore";
}

/**
 * First guess for "Match columns": header synonyms, then data. Exactly one column becomes Email
 * (the best-looking one); several may become Full name (joined) or Lists (merged). A first row
 * that contains an email address is data, not a header.
 */
export function guessColumns(grid: SheetGrid): ColumnMapping {
  const start = grid.findIndex((row) => !isBlank(row));
  if (start === -1) {
    return { hasHeader: false, targets: [] };
  }
  const columns = Array.from(
    { length: Math.max(...grid.map((row) => row.length)) },
    (_, i) => i,
  );
  const header = grid[start];
  const hasHeader = !header.some(looksLikeEmail);
  const sample = grid
    .slice(hasHeader ? start + 1 : start)
    .filter((row) => !isBlank(row))
    .slice(0, SAMPLE_ROWS);
  const emailShare = (column: number): number =>
    sample.length === 0
      ? 0
      : sample.filter((row) => looksLikeEmail(row[column] ?? "")).length /
        sample.length;

  const targets: ColumnTarget[] = columns.map((column) =>
    hasHeader ? targetForHeader(header[column] ?? "") : "ignore",
  );
  const named = columns.filter((column) => targets[column] === "email");
  const candidates =
    named.length > 0
      ? named
      : columns.filter((column) => emailShare(column) >= EMAIL_SHARE_MIN);
  const emailColumn = [...candidates].sort(
    (a, b) => emailShare(b) - emailShare(a),
  )[0];
  const withOneEmail = targets.map((target, column): ColumnTarget => {
    if (column === emailColumn) {
      return "email";
    }
    return target === "email" ? "ignore" : target;
  });
  if (!hasHeader) {
    const nameColumn = columns.find(
      (column) =>
        column !== emailColumn &&
        sample.some((row) => (row[column] ?? "") !== ""),
    );
    if (nameColumn !== undefined) {
      withOneEmail[nameColumn] = "fullName";
    }
  }
  return { hasHeader, targets: withOneEmail };
}

/** Why "Preview" is disabled: the import needs exactly one Email column. */
export function mappingProblem(
  mapping: ColumnMapping,
): "no_email" | "several_emails" | null {
  const emails = mapping.targets.filter((target) => target === "email").length;
  if (emails === 0) {
    return "no_email";
  }
  return emails > 1 ? "several_emails" : null;
}
