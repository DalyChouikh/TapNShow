"use client";

import { BellRinging, BellSlash, Check } from "@phosphor-icons/react";
import { useNow, useTranslations } from "next-intl";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sticker } from "@/components/ui/sticker";
import { DEVICE_KEYS, REMINDERS_NOT_NOW_DAYS } from "@/config/members";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { useReminders } from "@/hooks/use-reminders";
import { useDeviceKind } from "@/lib/device/kind";
import { readDeviceValue, writeDeviceValue } from "@/lib/device/storage";
import { useIsClient } from "@/lib/use-is-client";
import { IphoneInstallSheet } from "./iphone-install-sheet";

const DAY_MS = 86_400_000;

/**
 * The reminders card at the top of `/invites` (spec §7.4, mockup 2026-10-14). It changes with the
 * device: Turn on (and Install where the browser offers it), the iPhone Home Screen steps, or a
 * blocked note. "Not now" or "Hide" hides it on this device for 30 days; the Account page keeps
 * the switch. After turning on it says so once.
 */
export function RemindersCard() {
  const t = useTranslations("Reminders");
  const { state, turnOn, pending, justTurnedOn } = useReminders();
  const { canInstall, install } = useInstallPrompt();
  const isClient = useIsClient();
  const now = useNow();
  const device = useDeviceKind();
  const thisDevice = t("thisDevice", { device });
  const [dismissed, setDismissed] = useState(false);
  const [guide, setGuide] = useState(false);
  if (state === "on" && justTurnedOn) {
    return (
      <p role="status" className="flex items-center gap-2 font-bold">
        <Sticker tone="success" size="sm">
          <Check weight="bold" />
        </Sticker>
        {t("on", { thisDevice })}
      </p>
    );
  }
  const hiddenUntil = isClient
    ? readDeviceValue(DEVICE_KEYS.remindersHiddenUntil, z.iso.datetime())
    : null;
  const hidden =
    dismissed ||
    (hiddenUntil !== null && Date.parse(hiddenUntil) > now.getTime());
  if (
    !isClient ||
    hidden ||
    (state !== "off" && state !== "needs_install" && state !== "blocked")
  ) {
    return null;
  }
  const hide = () => {
    writeDeviceValue(
      DEVICE_KEYS.remindersHiddenUntil,
      new Date(Date.now() + REMINDERS_NOT_NOW_DAYS * DAY_MS).toISOString(),
    );
    setDismissed(true);
  };
  const blocked = state === "blocked";
  const iphone = state === "needs_install";
  return (
    <Card as="section" className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Sticker tone={blocked ? "warning" : "primary"}>
          {blocked ? (
            <BellSlash weight="bold" />
          ) : (
            <BellRinging weight="bold" />
          )}
        </Sticker>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-bold">
            {blocked ? t("blockedTitle") : t("cardTitle", { thisDevice })}
          </h2>
          <p className="text-sm">
            {blocked
              ? t("blockedBody")
              : iphone
                ? t("homeScreenBody", { device })
                : t("cardBody")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {state === "off" ? (
          <Button tone="primary" disabled={pending} onClick={turnOn}>
            {t("turnOn")}
          </Button>
        ) : null}
        {state === "off" && canInstall ? (
          <Button onClick={() => void install()}>{t("install")}</Button>
        ) : null}
        {iphone ? (
          <Button tone="primary" onClick={() => setGuide(true)}>
            {t("showMe")}
          </Button>
        ) : null}
        <Button onClick={hide}>{blocked ? t("hide") : t("notNow")}</Button>
      </div>
      <IphoneInstallSheet open={guide} onOpenChange={setGuide} />
    </Card>
  );
}
