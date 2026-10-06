"use client";

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

/** Destructive confirmation by typing the workspace name (spec §7.11). Case-sensitive, trimmed. */
export function ConfirmNameDialog({
  open,
  onOpenChange,
  title,
  body,
  name,
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
        <Input
          id="confirm-name"
          autoComplete="off"
          label={t("typeName", { workspace: name })}
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
