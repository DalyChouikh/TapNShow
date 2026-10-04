"use client";

import {
  CalendarBlankIcon,
  CheckIcon,
  ClockIcon,
  HourglassMediumIcon,
  MapPinIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmStamp } from "@/components/motion/confirm-stamp";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Sticker } from "@/components/ui/sticker";
import { FILL_TONES } from "@/design/tokens";

type Choice = "none" | "attend" | "late";
const DELAYS = ["delayShort", "delayMedium", "delayLong"] as const;

/** Interactive tour of tokens, components and motion. */
export function DesignShowcase() {
  const t = useTranslations("Design");
  const [choice, setChoice] = useState<Choice>("none");
  const [delay, setDelay] = useState<(typeof DELAYS)[number] | null>(null);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <ThemeToggle />
      </header>

      <Stagger className="flex flex-col gap-6">
        <StaggerItem>
          <Card as="section" aria-label={t("colors")}>
            <h2 className="mb-3 font-bold">{t("colors")}</h2>
            <div className="flex flex-wrap gap-2">
              {FILL_TONES.map((tone) => (
                <Sticker key={tone} tone={tone} label={t("tone", { tone })}>
                  <CheckIcon weight="bold" />
                </Sticker>
              ))}
            </div>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card as="section" aria-label={t("demo")}>
            <h2 className="mb-3 font-display text-xl">{t("meetingTitle")}</h2>
            <ul className="mb-4 flex flex-col gap-2 text-sm font-medium">
              <li className="flex items-center gap-3">
                <Sticker tone="primary">
                  <CalendarBlankIcon weight="bold" />
                </Sticker>
                {t("meetingDate")}
              </li>
              <li className="flex items-center gap-3">
                <Sticker tone="warning">
                  <ClockIcon weight="bold" />
                </Sticker>
                {t("meetingTime")}
              </li>
              <li className="flex items-center gap-3">
                <Sticker tone="info">
                  <MapPinIcon weight="bold" />
                </Sticker>
                {t("meetingPlace")}
              </li>
            </ul>

            {choice === "attend" ? (
              <div className="flex flex-col gap-3">
                <ConfirmStamp label={t("confirmed")} show />
                <Button onClick={() => setChoice("none")}>{t("reset")}</Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <Button
                  tone="success"
                  size="lg"
                  onClick={() => setChoice("attend")}
                >
                  {t("attend")}
                  <Sticker size="sm">
                    <CheckIcon weight="bold" />
                  </Sticker>
                </Button>
                <Button
                  tone="warning"
                  size="lg"
                  onClick={() => setChoice("late")}
                >
                  {t("late")}
                  <Sticker size="sm">
                    <HourglassMediumIcon weight="bold" />
                  </Sticker>
                </Button>
                {choice === "late" ? (
                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-2 text-sm font-bold">
                      {t("delay")}
                    </legend>
                    <div className="flex flex-wrap gap-2">
                      {DELAYS.map((key) => (
                        <Chip
                          key={key}
                          tone="warning"
                          pressed={delay === key}
                          onPressedChange={(on) => setDelay(on ? key : null)}
                        >
                          {t(key)}
                        </Chip>
                      ))}
                    </div>
                    <Input
                      id="demo-reason"
                      label={t("reasonLabel")}
                      hint={t("reasonHint")}
                    />
                  </fieldset>
                ) : null}
                <Button tone="danger" size="lg">
                  {t("absent")}
                  <Sticker size="sm">
                    <XIcon weight="bold" />
                  </Sticker>
                </Button>
              </div>
            )}
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card as="section" aria-label={t("inputs")}>
            <h2 className="mb-3 font-bold">{t("inputs")}</h2>
            <Input
              id="demo-error"
              label={t("reasonLabel")}
              error={t("reasonError")}
            />
          </Card>
        </StaggerItem>
      </Stagger>
    </main>
  );
}
