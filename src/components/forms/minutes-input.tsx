"use client";

import { Input } from "@/components/ui/input";

/**
 * A number of minutes typed by hand (a late time: check-in "Other", a delay choice "Other"): digits
 * only, with the phone's number pad, committed on Enter or when the field loses focus (a phone's
 * number pad has no Enter key). The parent parses and checks the value.
 */
export function MinutesInput({
  id,
  label,
  value,
  error,
  onValueChange,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onValueChange: (digits: string) => void;
  onCommit: () => void;
}) {
  return (
    <Input
      id={id}
      label={label}
      inputMode="numeric"
      value={value}
      error={error}
      onChange={(event) => onValueChange(event.target.value.replace(/\D/g, ""))}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit();
        }
      }}
    />
  );
}
