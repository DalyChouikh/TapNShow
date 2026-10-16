import type { ReactNode } from "react";

/**
 * Label and value pairs, one row each: the label on the left, the value on the right (on its own
 * line when both don't fit a phone).
 */
export function FactList({
  facts,
}: {
  facts: ReadonlyArray<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="flex flex-col">
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-dashed border-outline/30 py-2 last:border-b-0"
        >
          <dt className="text-muted-ink">{fact.label}</dt>
          <dd className="ml-auto min-w-0 text-right font-bold break-words">
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
