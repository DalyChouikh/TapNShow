"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * "Are you sure?" for important actions (owner rule, spec §4 Confirmations): the title states the
 * consequence ("Send 30 invites from club@gmail.com now?"), the button repeats the action.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = "primary",
  pending = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
  pending?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const t = useTranslations("Common");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button tone={tone} disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
