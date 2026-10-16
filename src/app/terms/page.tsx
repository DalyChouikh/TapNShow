import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { PublicShell } from "@/components/public/public-shell";
import { APP_NAME } from "@/config/app";
import { terms } from "@/content/legal/terms";

export const metadata: Metadata = {
  title: `${terms.title} · ${APP_NAME}`,
  description: terms.summary[0],
  alternates: { canonical: "/terms" },
};

/** `/terms` (spec §7.18): public, its own address (Google's consent screen links it). */
export default function TermsPage() {
  return (
    <PublicShell>
      <LegalPage document={terms} />
    </PublicShell>
  );
}
