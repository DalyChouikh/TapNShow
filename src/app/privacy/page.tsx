import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { PublicShell } from "@/components/public/public-shell";
import { APP_NAME } from "@/config/app";
import { privacyPolicy } from "@/content/legal/privacy";

export const metadata: Metadata = {
  title: `${privacyPolicy.title} · ${APP_NAME}`,
  description: privacyPolicy.summary[0],
  alternates: { canonical: "/privacy" },
};

/** `/privacy` (spec §7.18): public, its own address (Google's consent screen links it). */
export default function PrivacyPage() {
  return (
    <PublicShell>
      <LegalPage document={privacyPolicy} />
    </PublicShell>
  );
}
