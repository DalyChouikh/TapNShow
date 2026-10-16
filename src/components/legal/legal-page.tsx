import { Lightbulb } from "@phosphor-icons/react/dist/ssr";
import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import type { LegalDocument } from "@/content/legal/types";
import { renderLegalHtml } from "@/lib/markdown/legal";

/**
 * One legal page (spec §7.18): title and date, the In short card, a jump list built from the same
 * sections it renders (so they cannot drift), numbered sections, the not-a-lawyer note.
 */
export function LegalPage({ document }: { document: LegalDocument }) {
  const t = useTranslations("Legal");
  // A calendar date (YYYY-MM-DD): no time zone involved.
  const date = format(parseISO(document.updated), "d MMMM yyyy");
  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-4xl">{document.title}</h1>
        <p className="text-muted-ink">{t("updated", { date })}</p>
      </header>
      <Card
        as="section"
        aria-labelledby="in-short"
        className="bg-fill-info text-on-fill"
      >
        <h2 id="in-short" className="flex items-center gap-2 font-bold">
          <Lightbulb weight="bold" aria-hidden className="size-5" />
          {t("inShort")}
        </h2>
        <ul className="mt-2 list-disc pl-5">
          {document.summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Card>
      <nav aria-label={t("onThisPage")} className="flex flex-col">
        <p className="pb-1 text-xs font-bold tracking-wide text-muted-ink uppercase">
          {t("onThisPage")}
        </p>
        {document.sections.map((section, index) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="min-h-11 content-center border-b border-dashed border-outline/30 font-bold"
          >
            {index + 1}. {section.title}
          </a>
        ))}
      </nav>
      {document.sections.map((section, index) => (
        <section
          key={section.id}
          aria-labelledby={section.id}
          className="scroll-mt-20"
        >
          <h2 id={section.id} className="font-display text-xl">
            {index + 1}. {section.title}
          </h2>
          <div
            className="legal-body mt-2 flex flex-col gap-3"
            dangerouslySetInnerHTML={{ __html: renderLegalHtml(section.body) }}
          />
        </section>
      ))}
      <p className="text-sm text-muted-ink">{t("notLawyer")}</p>
    </article>
  );
}
