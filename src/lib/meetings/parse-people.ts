import { emailSchema } from "@/shared/api/common";

/** One pasted line, with what is wrong with it (if anything). */
export type ParsedPerson = {
  fullName: string;
  email: string;
  problem: "name" | "email" | null;
};

const ANGLE = /^(.*?)<([^>]+)>\s*$/;
const SEPARATORS = /[,;\t]/;

function split(line: string): { name: string; email: string } {
  const angle = ANGLE.exec(line);
  if (angle) {
    return { name: angle[1], email: angle[2] };
  }
  const parts = line
    .split(SEPARATORS)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 1) {
    return parts[0].includes("@")
      ? { name: "", email: parts[0] }
      : { name: parts[0], email: "" };
  }
  const emailIndex = parts.findIndex((part) => part.includes("@"));
  const at = emailIndex === -1 ? parts.length - 1 : emailIndex;
  return {
    name: parts.filter((_, index) => index !== at).join(" "),
    email: parts[at],
  };
}

/** Reads "name, email" lines pasted into "Add people" (also `Name <email>`, `;`, tabs, email first). */
export function parsePeopleList(text: string): ParsedPerson[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const { name, email } = split(line);
      const fullName = name.replace(/\s+/g, " ").trim();
      const parsed = emailSchema.safeParse(email);
      const normalized = parsed.success ? parsed.data : email.trim();
      return {
        fullName,
        email: normalized,
        problem: !parsed.success ? "email" : fullName === "" ? "name" : null,
      };
    });
}
