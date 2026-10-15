import Link from "next/link";
import { useTranslations } from "next-intl";
import { APP_NAME } from "@/config/app";
import { LEGAL_LINKS } from "@/config/legal";

/**
 * Footer of every public page (spec §7.18): Privacy, Terms, Contact, the maker. A dark band in
 * both themes (ink on light pages, the dark surface on dark ones).
 */
export function PublicFooter({ contact }: { contact: string }) {
  const t = useTranslations("Public");
  return (
    <footer className="border-t-[length:var(--tn-border-width)] border-outline bg-ink text-surface dark:bg-surface dark:text-ink">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 text-sm">
        <p className="font-display text-base">{APP_NAME}</p>
        <nav
          aria-label={t("footerLabel")}
          className="flex flex-wrap gap-x-5 gap-y-2"
        >
          <Link
            className="underline underline-offset-4"
            href={LEGAL_LINKS.privacy}
          >
            {t("privacy")}
          </Link>
          <Link
            className="underline underline-offset-4"
            href={LEGAL_LINKS.terms}
          >
            {t("terms")}
          </Link>
          <a className="underline underline-offset-4" href={contact}>
            {t("contact")}
          </a>
        </nav>
        <p className="opacity-80">{t("madeBy")}</p>
      </div>
    </footer>
  );
}
