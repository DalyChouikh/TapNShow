"use client";

import { Export } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sticker } from "@/components/ui/sticker";
import type { DeviceKind } from "@/lib/device/kind";

const STEPS = ["step1", "step2", "step3"] as const;

/** The three Home Screen steps an iPhone or iPad needs before it can show reminders (spec §7.4). */
export function IphoneInstallSheet({
  open,
  onOpenChange,
  device,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** iPad Safari has Share at the top, iPhone at the bottom. */
  device: DeviceKind;
}) {
  const t = useTranslations("Reminders");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sheetTitle")}</DialogTitle>
        </DialogHeader>
        <ol className="flex flex-col gap-3">
          {STEPS.map((step, index) => (
            <li key={step} className="flex items-center gap-3">
              <Sticker tone={index === 0 ? "info" : "surface"} size="sm">
                {index === 0 ? (
                  <Export weight="bold" aria-hidden />
                ) : (
                  <span className="text-xs font-bold">{index + 1}</span>
                )}
              </Sticker>
              <span>{t(step, { device })}</span>
            </li>
          ))}
        </ol>
        <DialogFooter>
          <Button tone="primary" onClick={() => onOpenChange(false)}>
            {t("gotIt")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
