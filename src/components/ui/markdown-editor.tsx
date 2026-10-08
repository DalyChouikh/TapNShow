"use client";

import {
  LinkSimple,
  ListBullets,
  TextB,
  TextItalic,
  type Icon,
} from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import {
  applyMarkdownAction,
  type MarkdownAction,
} from "@/lib/markdown/editor-actions";
import { renderAgendaHtml } from "@/lib/markdown/agenda";
import { Button } from "./button";
import { SegmentedControl } from "./segmented-control";
import { Textarea } from "./textarea";

const TOOLS: ReadonlyArray<{
  action: MarkdownAction;
  icon: Icon;
  label: "bold" | "italic" | "list" | "link";
}> = [
  { action: "bold", icon: TextB, label: "bold" },
  { action: "italic", icon: TextItalic, label: "italic" },
  { action: "list", icon: ListBullets, label: "list" },
  { action: "link", icon: LinkSimple, label: "link" },
];

/** Agenda editor (spec §7.2 Details): Markdown with a small toolbar and a safe preview. */
export function MarkdownEditor({
  id,
  label,
  value,
  onChange,
  onBlur,
  hint,
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  hint?: string;
  maxLength: number;
}) {
  const t = useTranslations("MarkdownEditor");
  const [mode, setMode] = useState<"write" | "preview">("write");
  const area = useRef<HTMLTextAreaElement>(null);
  const apply = (action: MarkdownAction) => {
    const element = area.current;
    const next = applyMarkdownAction(
      value,
      element?.selectionStart ?? value.length,
      element?.selectionEnd ?? value.length,
      action,
    );
    onChange(next.text.slice(0, maxLength));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(next.start, next.end);
    });
  };
  const html = renderAgendaHtml(value);
  return (
    <div className="flex flex-col gap-2">
      <SegmentedControl
        label={label}
        value={mode}
        onValueChange={(next) =>
          setMode(next === "preview" ? "preview" : "write")
        }
        options={[
          { value: "write", label: t("write") },
          { value: "preview", label: t("preview") },
        ]}
      />
      {mode === "write" ? (
        <>
          <div className="flex gap-2">
            {TOOLS.map(({ action, icon: Glyph, label: key }) => (
              <Button
                key={action}
                aria-label={t(key)}
                className="size-11 justify-center px-0"
                onClick={() => apply(action)}
              >
                <Glyph weight="bold" aria-hidden />
              </Button>
            ))}
          </div>
          <Textarea
            ref={area}
            id={id}
            label={label}
            hint={hint}
            value={value}
            maxLength={maxLength}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
          />
        </>
      ) : html ? (
        // renderAgendaHtml escapes raw HTML and keeps only http(s)/mailto links, so this is safe.
        <div
          className="agenda-preview rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface p-3 text-sm"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <p className="text-sm text-muted-ink">{t("empty")}</p>
      )}
    </div>
  );
}
