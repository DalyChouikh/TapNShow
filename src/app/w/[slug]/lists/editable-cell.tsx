"use client";

import { useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

const MOVES: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

/** Focuses the cell at row/column offset from `from` (cells carry `data-cell="row:col"`). */
function focusNeighbour(
  from: HTMLElement,
  rowIndex: number,
  columnIndex: number,
  key: string,
): boolean {
  const move = MOVES[key];
  if (!move) {
    return false;
  }
  const target = from
    .closest("table")
    ?.querySelector<HTMLElement>(
      `[data-cell="${rowIndex + move[0]}:${columnIndex + move[1]}"]`,
    );
  target?.focus();
  return Boolean(target);
}

/**
 * Spreadsheet-like cell: a button showing the value; Enter or a click turns it into a field.
 * Enter or leaving commits (only when changed and `validate` returns null), Escape restores.
 * Arrow keys move between cells while not editing.
 */
export function EditableCell({
  value,
  label,
  onCommit,
  validate,
  rowIndex,
  columnIndex,
  inputType = "text",
}: {
  value: string;
  label: string;
  onCommit: (value: string) => void;
  validate: (value: string) => string | null;
  rowIndex: number;
  columnIndex: number;
  inputType?: "text" | "email";
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = (commit: boolean) => {
    if (draft === null) {
      return;
    }
    if (commit && draft.trim() !== value) {
      const problem = validate(draft);
      if (problem) {
        setError(problem);
        return;
      }
      onCommit(draft.trim());
    }
    setDraft(null);
    setError(null);
  };

  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDraft(null);
      setError(null);
    }
  };

  if (draft !== null) {
    return (
      <div className="flex flex-col gap-1">
        <input
          autoFocus
          type={inputType}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onFieldKey}
          onBlur={() => finish(true)}
          className="min-h-11 w-full rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface px-2 text-sm text-ink aria-invalid:bg-fill-danger aria-invalid:text-on-fill"
        />
        {error ? <span className="text-xs font-bold">{error}</span> : null}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      data-cell={`${rowIndex}:${columnIndex}`}
      onClick={() => setDraft(value)}
      onKeyDown={(event) => {
        if (
          focusNeighbour(event.currentTarget, rowIndex, columnIndex, event.key)
        ) {
          event.preventDefault();
        }
      }}
      className={cn(
        "min-h-11 w-full truncate rounded-control px-2 text-left text-sm hover:bg-fill-neutral/40 focus-visible:outline-3",
      )}
    >
      {value}
    </button>
  );
}
