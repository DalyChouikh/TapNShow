"use client";

import { UploadSimple } from "@phosphor-icons/react";
import { useState, type DragEvent } from "react";
import { cn } from "@/lib/utils";
import { Sticker } from "./sticker";

/**
 * Drop area + file chooser. The native file input stays in the DOM for keyboard and screen-reader
 * users but is visually hidden; the whole card is its label, so tapping anywhere opens the picker.
 */
export function FileDropZone({
  id,
  title,
  hint,
  accept,
  onFile,
  disabled = false,
}: {
  id: string;
  title: string;
  hint: string;
  accept: string;
  onFile: (file: File) => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !disabled) {
      onFile(file);
    }
  };
  return (
    <label
      htmlFor={id}
      data-testid={`${id}-zone`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-2 rounded-card border-[length:var(--tn-border-width)] border-dashed border-outline bg-surface px-4 py-6 text-center shadow-brutal-sm transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 motion-reduce:transition-none",
        dragging && "bg-fill-info",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <Sticker tone="info">
        <UploadSimple weight="bold" />
      </Sticker>
      <span id={`${id}-title`} className="font-bold">
        {title}
      </span>
      <span id={`${id}-hint`} className="text-sm text-muted-ink">
        {hint}
      </span>
      <input
        id={id}
        type="file"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-hint`}
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onFile(file);
          }
          event.target.value = "";
        }}
      />
    </label>
  );
}
