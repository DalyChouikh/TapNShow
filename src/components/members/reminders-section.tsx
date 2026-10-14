"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { useReminders } from "@/hooks/use-reminders";
import { useDeviceKind } from "@/lib/device/kind";
import { IphoneInstallSheet } from "./iphone-install-sheet";

/**
 * "Reminders on this phone" on `/account` (spec §7.4): the switch that always stays, even after
 * the card on `/invites` is hidden. Off, with the reason, where this device can't take reminders.
 */
export function RemindersSection() {
  const t = useTranslations("Reminders");
  const { state, turnOn, turnOff, pending } = useReminders();
  const { canInstall, install } = useInstallPrompt();
  const [guide, setGuide] = useState(false);
  const device = useDeviceKind();
  if (state === null || state === "unavailable") {
    return null;
  }
  const hint =
    state === "blocked"
      ? t("blockedTitle")
      : state === "unsupported"
        ? t("unsupported")
        : state === "needs_install"
          ? t("homeScreenBody", { device })
          : null;
  return (
    <Card as="section" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-bold" id="reminders-title">
            {t("sectionTitle", { thisDevice: t("thisDevice", { device }) })}
          </h2>
          <p className="text-sm">{t("sectionBody")}</p>
        </div>
        <Switch
          aria-labelledby="reminders-title"
          checked={state === "on"}
          disabled={pending || hint !== null}
          onCheckedChange={(on) => (on ? turnOn() : turnOff())}
        />
      </div>
      {hint ? <p className="text-sm text-muted-ink">{hint}</p> : null}
      <div className="flex flex-wrap gap-2">
        {state === "needs_install" ? (
          <Button onClick={() => setGuide(true)}>{t("showMe")}</Button>
        ) : null}
        {canInstall ? (
          <Button onClick={() => void install()}>{t("install")}</Button>
        ) : null}
      </div>
      <IphoneInstallSheet
        open={guide}
        onOpenChange={setGuide}
        device={device}
      />
    </Card>
  );
}
