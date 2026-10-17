import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Features } from "@/components/landing/features";
import { FinalCall } from "@/components/landing/final-call";
import { HowItWorks } from "@/components/landing/how-it-works";
import { LandingFaq } from "@/components/landing/landing-faq";
import { LandingHero } from "@/components/landing/landing-hero";
import { PrivacyStrip } from "@/components/landing/privacy-strip";
import { PublicShell } from "@/components/public/public-shell";
import { JsonLd, websiteJsonLd } from "@/components/seo/json-ld";
import { publicEnv } from "@/config/public-env";
import { publicPageMetadata } from "@/lib/seo/public-metadata";

/** Title, description and the share card (spec §7.18). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Landing");
  return publicPageMetadata({
    path: "/",
    title: t("metaTitle"),
    description: t("metaDescription"),
  });
}

/**
 * The landing (spec §7.18, layout A) for organizers of other groups, shown to everyone with no
 * redirect: Google's reviewers arrive signed out, and the installed app opens `/invites`.
 */
export default function HomePage() {
  return (
    <PublicShell>
      <JsonLd data={websiteJsonLd(publicEnv.NEXT_PUBLIC_APP_URL)} />
      <LandingHero />
      <HowItWorks />
      <Features />
      <PrivacyStrip />
      <LandingFaq />
      <FinalCall />
    </PublicShell>
  );
}
