"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Accordion } from "radix-ui";

const QUESTIONS = ["free", "account", "who", "groups"] as const;

/** The FAQ (spec §7.18): one answer open at a time. */
export function LandingFaq() {
  const t = useTranslations("Landing.faq");
  return (
    <section
      aria-labelledby="faq-title"
      className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-10"
    >
      <h2 id="faq-title" className="font-display text-2xl">
        {t("title")}
      </h2>
      <Accordion.Root type="single" collapsible className="flex flex-col gap-2">
        {QUESTIONS.map((key) => (
          <Accordion.Item
            key={key}
            value={key}
            className="rounded-control border-[length:var(--tn-border-width)] border-outline bg-surface"
          >
            <Accordion.Header>
              <Accordion.Trigger className="group flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left font-bold">
                {t(`${key}.q`)}
                <CaretDown
                  weight="bold"
                  aria-hidden
                  className="size-5 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                />
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content className="px-3 pb-3 text-muted-ink">
              {t(`${key}.a`)}
            </Accordion.Content>
          </Accordion.Item>
        ))}
      </Accordion.Root>
    </section>
  );
}
