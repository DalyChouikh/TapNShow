import Link from "next/link";
import { useTranslations } from "next-intl";
import { LEGAL_LINKS } from "@/config/legal";
import { cn } from "@/lib/utils";

/** How every link to the legal pages looks in running text and link rows. */
export const LEGAL_LINK_CLASS = "underline underline-offset-4";

/** Privacy · Terms · Contact (spec §7.18): the public footer and the end of `/account`. */
export function LegalNav({
  contact,
  className,
}: {
  /** The Contact link (`contactHref(SMTP_FROM)`). */
  contact: string;
  className?: string;
}) {
  const t = useTranslations("Public");
  return (
    <nav
      aria-label={t("footerLabel")}
      className={cn("flex flex-wrap gap-x-5 gap-y-2", className)}
    >
      <Link className={LEGAL_LINK_CLASS} href={LEGAL_LINKS.privacy}>
        {t("privacy")}
      </Link>
      <Link className={LEGAL_LINK_CLASS} href={LEGAL_LINKS.terms}>
        {t("terms")}
      </Link>
      <a className={LEGAL_LINK_CLASS} href={contact}>
        {t("contact")}
      </a>
    </nav>
  );
}
