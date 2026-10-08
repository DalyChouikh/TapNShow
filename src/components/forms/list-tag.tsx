import type { FillTone } from "@/design/tokens";
import { cn } from "@/lib/utils";
import type { ListSummary } from "@/shared/api/roster";

const TONES: readonly FillTone[] = ["primary", "success", "warning", "info"];
/** Tailwind fill class per tone (shared by list tags and the import preview). */
export const LIST_FILL: Record<FillTone, string> = {
  primary: "bg-fill-primary",
  success: "bg-fill-success",
  warning: "bg-fill-warning",
  danger: "bg-fill-danger",
  info: "bg-fill-info",
  neutral: "bg-fill-neutral",
};

/** Same pastel for a list everywhere (stable from its id). */
export function listTone(listId: string): FillTone {
  const sum = [...listId].reduce(
    (total, char) => total + char.charCodeAt(0),
    0,
  );
  return TONES[sum % TONES.length];
}

/** Small read-only pill naming a list on a card or row. */
export function ListTag({
  list,
  className,
}: {
  list: Pick<ListSummary, "id" | "name">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-full border-2 border-outline px-2 text-xs font-bold text-on-fill",
        LIST_FILL[listTone(list.id)],
        className,
      )}
    >
      {list.name}
    </span>
  );
}
