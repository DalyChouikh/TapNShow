"use client";

import { Copy } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";

/**
 * Destructive confirmation by typing a word (the workspace name, or "confirm" for an account; spec
 * §7.11, §7.4). Case-sensitive, trimmed; the word has a copy button (owner, 2026-10-14).
 */
export function ConfirmNameDialog({
  open,
  onOpenChange,
  title,
  body,
  name,
  inputLabel,
  confirmLabel,
  onConfirm,
  pending = false,
  error,
  canConfirm = true,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  name: string;
  /** The field's label (default: "Type <name> to confirm"). */
  inputLabel?: string;
  confirmLabel: string;
  onConfirm: (typedName: string) => void;
  pending?: boolean;
  error?: string;
  canConfirm?: boolean;
  children?: ReactNode;
}) {
  const t = useTranslations("Settings.danger");
  const tCommon = useTranslations("Common");
  const [typed, setTyped] = useState("");
  const close = (next: boolean) => {
    if (!next) {
      setTyped("");
    }
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {children}
        <div className="flex items-center gap-2">
          <span className="min-w-0 rounded-lg border-2 border-outline bg-background px-2 font-mono font-bold break-all">
            {name}
          </span>
          <Button
            className="size-11 shrink-0 justify-center px-0"
            aria-label={tCommon("copyWord", { word: name })}
            onClick={async () => {
              if (await copyText(name)) {
                toast(tCommon("copied"));
              } else {
                toast.error(tCommon("copyFailed"));
              }
            }}
          >
            <Copy weight="bold" aria-hidden />
          </Button>
        </div>
        <Input
          id="confirm-name"
          autoComplete="off"
          label={inputLabel ?? t("typeName", { workspace: name })}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          error={error}
        />
        <DialogFooter>
          <Button onClick={() => close(false)}>{tCommon("cancel")}</Button>
          <Button
            tone="danger"
            disabled={!canConfirm || pending || typed.trim() !== name}
            onClick={() => onConfirm(typed.trim())}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
