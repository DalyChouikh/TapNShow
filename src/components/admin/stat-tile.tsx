import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** One figure in a `<dl>` grid: its label, the big number and an optional small line. */
export function StatTile({
  label,
  value,
  line,
}: {
  label: string;
  value: string;
  line?: ReactNode;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-1 p-3">
      <dt className="text-sm font-bold text-muted-ink">{label}</dt>
      <dd className="font-display text-2xl">{value}</dd>
      {line ? <dd className="text-sm text-muted-ink">{line}</dd> : null}
    </Card>
  );
}
