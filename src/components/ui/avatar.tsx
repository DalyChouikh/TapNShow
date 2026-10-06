import { cn } from "@/lib/utils";

/** First letters of the first two words of the name, else the email's first letter. */
export function initialsFor(name: string | null, email: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 0
      ? words.slice(0, 2).map((word) => word[0])
      : [(email ?? "?")[0]];
  return letters.join("").toUpperCase();
}

/** Initials avatar in a sticker-like tile (decorative; the name is always shown next to it). */
export function Avatar({
  name,
  email,
  className,
}: {
  name: string | null;
  email: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-outline bg-fill-info text-sm font-bold text-on-fill shadow-brutal-sm",
        className,
      )}
    >
      {initialsFor(name, email)}
    </span>
  );
}
