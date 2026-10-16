import { useTranslations } from "next-intl";

const STEPS = ["connect", "invite", "watch"] as const;

/** "How it works" (spec §7.18): three numbered steps; the hero's "See how it works" jumps here. */
export function HowItWorks() {
  const t = useTranslations("Landing.how");
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-title"
      className="mx-auto flex max-w-5xl scroll-mt-20 flex-col gap-6 px-4 py-10"
    >
      <h2 id="how-title" className="font-display text-3xl">
        {t("title")}
      </h2>
      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full border-[length:var(--tn-border-width)] border-outline bg-fill-warning font-display text-lg text-on-fill"
            >
              {index + 1}
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="font-bold">{t(`steps.${step}.title`)}</h3>
              <p className="text-muted-ink">{t(`steps.${step}.body`)}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
