"use client";

import { useTranslations } from "next-intl";
import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

const EMPTY = " ";

function toSlots(value: string, length: number): string[] {
  return Array.from({ length }, (_, index) => {
    const char = value[index];
    return char && /\d/.test(char) ? char : EMPTY;
  });
}

/**
 * One-time-code entry as separate Neobrutalist boxes (sign-in codes). Typing advances, Backspace
 * goes back, arrows move, and a pasted or autofilled code (spaces/dashes allowed) fills every box.
 * `value` keeps one character per box (a space for an empty box); `onComplete` fires once all
 * boxes hold a digit.
 */
export function CodeInput({
  id,
  label,
  length,
  value,
  onChange,
  onComplete,
  hint,
  error,
  disabled = false,
}: {
  id: string;
  label: string;
  length: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (code: string) => void;
  hint?: string;
  error?: string;
  disabled?: boolean;
}) {
  const t = useTranslations("Auth");
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const slots = toSlots(value, length);
  const labelId = `${id}-label`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  const focus = (index: number) =>
    boxes.current[Math.max(0, Math.min(length - 1, index))]?.focus();

  const commit = (next: string[]) => {
    const joined = next.join("");
    onChange(joined);
    if (next.every((slot) => slot !== EMPTY)) {
      onComplete?.(joined);
    }
  };

  const fillFrom = (at: number, text: string) => {
    const all = text.replace(/\D/g, "");
    // A complete code (paste or autofill) always fills from the first box, wherever the cursor is.
    const index = all.length >= length ? 0 : at;
    const digits = all.slice(0, length - index);
    if (!digits) {
      return;
    }
    const next = [...slots];
    digits.split("").forEach((digit, offset) => {
      next[index + offset] = digit;
    });
    commit(next);
    focus(index + digits.length);
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      fillFrom(index, event.key);
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      const next = [...slots];
      const target = slots[index] === EMPTY ? index - 1 : index;
      if (target >= 0) {
        next[target] = EMPTY;
        commit(next);
        focus(target);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focus(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focus(index + 1);
    }
  };

  const onPaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    fillFrom(index, event.clipboardData.getData("text"));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-sm font-bold text-ink">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={
          [hintId, errorId].filter(Boolean).join(" ") || undefined
        }
        className="flex items-center gap-1 sm:gap-2"
      >
        {slots.map((slot, index) => (
          <input
            key={index}
            ref={(element) => {
              boxes.current[index] = element;
            }}
            id={index === 0 ? id : undefined}
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            aria-label={t("codeDigit", { index: index + 1, length })}
            aria-invalid={error ? true : undefined}
            disabled={disabled}
            value={slot === EMPTY ? "" : slot}
            onKeyDown={(event) => onKeyDown(index, event)}
            onPaste={(event) => onPaste(index, event)}
            onChange={(event) => fillFrom(index, event.target.value)}
            onFocus={(event) => event.target.select()}
            className={cn(
              "h-11 w-0 max-w-12 min-w-0 flex-1 rounded-sticker border-[length:var(--tn-border-width)] border-outline bg-surface p-0 text-center text-lg font-bold text-ink tabular-nums shadow-brutal-sm transition-[transform,background-color] duration-300 ease-spring motion-reduce:transition-none sm:w-10",
              index === length / 2 && "ml-2",
              slot !== EMPTY &&
                "-translate-y-0.5 bg-fill-warning text-on-fill motion-reduce:translate-y-0",
              error && "border-[color:var(--color-fill-danger)]",
            )}
          />
        ))}
      </div>
      {hint ? (
        <p id={hintId} className="text-sm text-muted-ink">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm font-bold text-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
