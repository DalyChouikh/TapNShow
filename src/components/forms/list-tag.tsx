import { Pill } from "@/components/ui/pill";
import type { FillTone } from "@/design/tokens";
import { cn } from "@/lib/utils";
import type { ListSummary } from "@/shared/api/roster";

const TONES: readonly FillTone[] = ["primary", "success", "warning", "info"];
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
    <Pill
      tone={listTone(list.id)}
      className={cn("inline-flex max-w-full items-center truncate", className)}
    >
      {list.name}
    </Pill>
  );
}
