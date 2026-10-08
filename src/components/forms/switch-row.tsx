"use client";

import { Switch } from "@/components/ui/switch";

/** A labelled switch row (label on the left, 44 px switch on the right). */
export function SwitchRow({
  id,
  label,
  checked,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="font-bold">
        {label}
      </label>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}
