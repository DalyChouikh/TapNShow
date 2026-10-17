import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { PublicShell } from "@/components/public/public-shell";
import { LEGAL_LINKS } from "@/config/legal";
import { privacyPolicy } from "@/content/legal/privacy";
import { legalPageMetadata } from "@/lib/seo/public-metadata";

export const metadata: Metadata = legalPageMetadata(
  privacyPolicy,
  LEGAL_LINKS.privacy,
);

/** `/privacy` (spec §7.18): public, its own address (Google's consent screen links it). */
export default function PrivacyPage() {
  return (
    <PublicShell>
      <LegalPage document={privacyPolicy} />
    </PublicShell>
  );
}
