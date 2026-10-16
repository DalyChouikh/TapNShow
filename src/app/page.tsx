import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Features } from "@/components/landing/features";
import { FinalCall } from "@/components/landing/final-call";
import { HowItWorks } from "@/components/landing/how-it-works";
import { LandingFaq } from "@/components/landing/landing-faq";
import { LandingHero } from "@/components/landing/landing-hero";
import { PrivacyStrip } from "@/components/landing/privacy-strip";
import { PublicShell } from "@/components/public/public-shell";

/** Title, description and the share card (spec §7.18). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Landing");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical: "/" },
    openGraph: {
      title: t("metaTitle"),
      description: t("metaDescription"),
      type: "website",
    },
  };
}

/**
 * The landing (spec §7.18, layout A) for organizers of other groups, shown to everyone with no
 * redirect: Google's reviewers arrive signed out, and the installed app opens `/invites`.
 */
export default function HomePage() {
  return (
    <PublicShell>
      <LandingHero />
      <HowItWorks />
      <Features />
      <PrivacyStrip />
      <LandingFaq />
      <FinalCall />
    </PublicShell>
  );
}
