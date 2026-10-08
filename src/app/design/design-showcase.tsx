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
import { useRef, useState } from "react";
import { ConfirmStamp } from "@/components/motion/confirm-stamp";
import { Stagger, StaggerItem } from "@/components/motion/stagger";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import { DatePicker } from "@/components/ui/date-picker";
import { FileDropZone } from "@/components/ui/file-drop-zone";
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Sticker } from "@/components/ui/sticker";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TimePicker } from "@/components/ui/time-picker";
import { FILL_TONES } from "@/design/tokens";

type Choice = "none" | "attend" | "late";
const DELAYS = ["delayShort", "delayMedium", "delayLong"] as const;

/** Interactive tour of tokens, components and motion. */
export function DesignShowcase() {
  const t = useTranslations("Design");
  const [choice, setChoice] = useState<Choice>("none");
  const [delay, setDelay] = useState<(typeof DELAYS)[number] | null>(null);
  const [source, setSource] = useState("file");
  const [date, setDate] = useState<string | null>("2026-10-09");
  const [time, setTime] = useState<string | null>("18:00");
  const [agenda, setAgenda] = useState("- Recap\n- **Hackathon** teams");
  const [confirming, setConfirming] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

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
              <div
                ref={resultRef}
                tabIndex={-1}
                data-testid="attend-result"
                className="flex flex-col gap-3 rounded-control focus-visible:outline-2"
              >
                <ConfirmStamp label={t("confirmed")} show />
                <Button onClick={() => setChoice("none")}>{t("reset")}</Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <Button
                  tone="success"
                  size="lg"
                  onClick={() => {
                    setChoice("attend");
                    // WCAG 2.4.3: focus the result once it has rendered.
                    requestAnimationFrame(() => resultRef.current?.focus());
                  }}
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

        <StaggerItem>
          <Card
            as="section"
            aria-label={t("controls")}
            className="flex flex-col gap-4"
          >
            <h2 className="font-bold">{t("controls")}</h2>
            <label className="flex min-h-11 items-center gap-3 font-bold">
              <Checkbox />
              {t("checkboxLabel")}
            </label>
            <label className="flex min-h-11 items-center gap-3 font-bold">
              <Switch defaultChecked />
              {t("switchLabel")}
            </label>
            <SegmentedControl
              label={t("sourceLabel")}
              value={source}
              onValueChange={setSource}
              options={[
                { value: "file", label: t("sourceFile") },
                { value: "paste", label: t("sourcePaste") },
              ]}
            />
            <Textarea
              id="demo-paste"
              label={t("pasteLabel")}
              hint={t("pasteHint")}
            />
            <FileDropZone
              id="demo-file"
              title={t("dropTitle")}
              hint={t("dropHint")}
              accept=".csv,.xlsx"
              onFile={() => undefined}
            />
          </Card>
        </StaggerItem>
        <StaggerItem>
          <Card
            as="section"
            aria-label={t("pickers")}
            className="flex flex-col gap-3"
          >
            <h2 className="font-bold">{t("pickers")}</h2>
            <div className="grid grid-cols-2 gap-3">
              <DatePicker
                id="demo-date"
                label={t("pickers")}
                value={date}
                today="2026-10-07"
                min="2026-10-07"
                onChange={setDate}
              />
              <TimePicker
                id="demo-time"
                label={t("pickers")}
                value={time}
                onChange={setTime}
              />
            </div>
          </Card>
        </StaggerItem>
        <StaggerItem>
          <Card
            as="section"
            aria-label={t("markdown")}
            className="flex flex-col gap-3"
          >
            <h2 className="font-bold">{t("markdown")}</h2>
            <MarkdownEditor
              id="demo-agenda"
              label={t("markdown")}
              value={agenda}
              onChange={setAgenda}
              maxLength={5000}
            />
          </Card>
        </StaggerItem>
        <StaggerItem>
          <Card
            as="section"
            aria-label={t("confirm")}
            className="flex flex-col gap-3"
          >
            <h2 className="font-bold">{t("confirm")}</h2>
            <Button tone="primary" onClick={() => setConfirming(true)}>
              {t("confirmOpen")}
            </Button>
            <ConfirmDialog
              open={confirming}
              onOpenChange={setConfirming}
              title={t("confirmTitle")}
              confirmLabel={t("confirmAction")}
              onConfirm={() => setConfirming(false)}
            />
          </Card>
        </StaggerItem>
      </Stagger>
    </main>
  );
}
