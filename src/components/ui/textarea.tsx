import type { Ref, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /** The underlying textarea (React 19 passes `ref` as a prop). */
  ref?: Ref<HTMLTextAreaElement>;
};

/** Labelled multi-line field with the same outline, shadow, hint and error wiring as `Input`. */
export function Textarea({
  id,
  label,
  hint,
  error,
  className,
  ...props
}: TextareaProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {label}
      </label>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "min-h-32 resize-y rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface px-3 py-2 font-mono text-sm text-ink shadow-brutal-sm placeholder:text-muted-ink aria-invalid:bg-fill-danger aria-invalid:text-on-fill",
          className,
        )}
        {...props}
      />
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
