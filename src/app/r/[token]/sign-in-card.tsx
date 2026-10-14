"use client";

import { Bell } from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sticker } from "@/components/ui/sticker";
import { useDeviceKind } from "@/lib/device/kind";

/**
 * After an answer, a quiet invitation to sign in for reminders and every invite in one place
 * (spec §7.4). The email is never pre-filled: a forwarded link must not reveal the address.
 */
export function SignInCard() {
  const t = useTranslations("AnswerPage");
  const tReminders = useTranslations("Reminders");
  const device = useDeviceKind();
  return (
    <Card className="flex flex-col gap-2 shadow-none">
      <div className="flex items-center gap-3">
        <Sticker tone="warning">
          <Bell weight="bold" aria-hidden />
        </Sticker>
        <p className="font-bold">
          {t("signInTitle", {
            thisDevice: tReminders("thisDevice", { device }),
          })}
        </p>
      </div>
      <p>{t("signInBody")}</p>
      <Button asChild>
        <Link href={`/login?next=${encodeURIComponent("/invites")}`}>
          {t("signIn")}
        </Link>
      </Button>
    </Card>
  );
}
