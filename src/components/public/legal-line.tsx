import Link from "next/link";
import { useTranslations } from "next-intl";
import { APP_NAME } from "@/config/app";
import { LEGAL_LINKS } from "@/config/legal";
import { LEGAL_LINK_CLASS } from "./legal-nav";

/**
 * Under the token pages' card (spec §7.18): "Sent with TapNShow · Privacy · Terms". The people a
 * group emails never signed up, so the page says where it comes from.
 */
export function LegalLine() {
  const t = useTranslations("Public");
  return (
    <p className="text-center text-sm text-muted-ink">
      {t("sentWith", { appName: APP_NAME })} ·{" "}
      <Link className={LEGAL_LINK_CLASS} href={LEGAL_LINKS.privacy}>
        {t("privacy")}
      </Link>{" "}
      ·{" "}
      <Link className={LEGAL_LINK_CLASS} href={LEGAL_LINKS.terms}>
        {t("terms")}
      </Link>
    </p>
  );
}
