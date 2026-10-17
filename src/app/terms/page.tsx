import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { PublicShell } from "@/components/public/public-shell";
import { LEGAL_LINKS } from "@/config/legal";
import { terms } from "@/content/legal/terms";
import { legalPageMetadata } from "@/lib/seo/public-metadata";

export const metadata: Metadata = legalPageMetadata(terms, LEGAL_LINKS.terms);

/** `/terms` (spec §7.18): public, its own address (Google's consent screen links it). */
export default function TermsPage() {
  return (
    <PublicShell>
      <LegalPage document={terms} />
    </PublicShell>
  );
}
