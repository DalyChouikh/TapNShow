import type { InputHTMLAttributes, Ref } from "react";
import { cn } from "@/lib/utils";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /** Keeps the label for assistive tech but hides it visually (e.g. a search field). */
  hideLabel?: boolean;
  /** The underlying input (React 19 passes `ref` as a prop). */
  ref?: Ref<HTMLInputElement>;
};

/** Labelled text input with accessible hint and error wiring. */
export function Input({
  id,
  label,
  hint,
  error,
  hideLabel = false,
  className,
  ...props
}: InputProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className={cn("text-sm font-bold text-ink", hideLabel && "sr-only")}
      >
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "min-h-11 rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface px-3 text-base text-ink shadow-brutal-sm placeholder:text-muted-ink aria-invalid:bg-fill-danger aria-invalid:text-on-fill aria-invalid:placeholder:text-on-fill-muted",
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
