"use client";

import { X } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { emailSchema } from "@/shared/api/common";

/** Separators that end an address while typing or inside a pasted list. */
const SEPARATORS = /[\s,;]+/;

/** Adds addresses (trimmed, lower-cased) to `current`, skipping blanks and duplicates. */
function addEmails(current: string[], raw: string): string[] {
  const next = [...current];
  for (const part of raw.split(SEPARATORS)) {
    const email = part.trim().toLowerCase();
    if (email && !next.includes(email)) {
      next.push(email);
    }
  }
  return next;
}

/**
 * Several email addresses as removable chips. Comma, space, semicolon, Enter, leaving the field,
 * or pasting a list turns text into chips; Backspace on an empty field removes the last one.
 * Invalid addresses stay visible (danger fill) so they can be fixed or removed.
 */
export function EmailChipsInput({
  id,
  label,
  value,
  onChange,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string[];
  onChange: (emails: string[]) => void;
  hint?: string;
  error?: string;
}) {
  const t = useTranslations("Invites");
  const [draft, setDraft] = useState("");
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  const commit = (raw: string) => {
    if (raw.trim()) {
      onChange(addEmails(value, raw));
    }
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      event.key === "Enter" ||
      event.key === "," ||
      event.key === " " ||
      event.key === ";"
    ) {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
      event.preventDefault();
      onChange(value.slice(0, -1));
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    commit(`${draft} ${event.clipboardData.getData("text")}`);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {label}
      </label>
      <div
        className={cn(
          "flex min-h-11 flex-wrap items-center gap-1.5 rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface p-1.5 shadow-brutal-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-outline",
          error && "bg-fill-danger",
        )}
      >
        {value.map((email) => {
          const invalid = !emailSchema.safeParse(email).success;
          return (
            <span
              key={email}
              data-invalid={invalid ? "" : undefined}
              className={cn(
                "inline-flex max-w-full animate-in items-center gap-1 rounded-full border-2 border-outline py-0.5 pr-0.5 pl-2.5 text-sm font-bold text-on-fill zoom-in-90 motion-reduce:animate-none",
                invalid ? "bg-fill-danger" : "bg-fill-primary",
              )}
            >
              <span className="truncate">{email}</span>
              <button
                type="button"
                aria-label={t("removeEmail", { email })}
                onClick={() => onChange(value.filter((item) => item !== email))}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full"
              >
                <X weight="bold" aria-hidden />
              </button>
            </span>
          );
        })}
        <input
          id={id}
          type="email"
          inputMode="email"
          autoComplete="off"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => commit(draft)}
          aria-describedby={
            [hintId, errorId].filter(Boolean).join(" ") || undefined
          }
          aria-invalid={error ? true : undefined}
          className="min-h-8 min-w-40 flex-1 bg-transparent px-1.5 text-base text-ink outline-hidden placeholder:text-muted-ink"
        />
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
