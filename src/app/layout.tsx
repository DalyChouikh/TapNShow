import { SerwistProvider } from "@serwist/turbopack/react";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { MotionProvider } from "@/components/motion/motion-provider";
import { InstallPromptProvider } from "@/components/providers/install-prompt-provider";
import { PageAnalytics } from "@/components/providers/page-analytics";
import { QueryProvider } from "@/components/providers/query-provider";
import { RegisterServiceWorker } from "@/components/providers/register-service-worker";
import { RemindersCheckIn } from "@/components/providers/reminders-check-in";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { APP_DESCRIPTION, APP_NAME } from "@/config/app";
import { publicEnv } from "@/config/public-env";
import { palette } from "@/design/tokens";
import { archivoBlack, spaceGrotesk } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  verification: publicEnv.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: publicEnv.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
    : undefined,
  icons: {
    icon: "/icons/favicon-32.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
};

/** The browser bar and the installed app's frame take the app background (spec §10 PWA). */
export const viewport: Viewport = { themeColor: palette.light.background };

/** Root layout: fonts, theme (no-flash), motion, i18n, the install offer, the service worker and the reminders check-in. */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  // This request's CSP nonce (proxy.ts). Reading headers renders every page per request, which the
  // nonce needs anyway (spec §11 M9).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${archivoBlack.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <NextIntlClientProvider>
          <ThemeProvider nonce={nonce}>
            <QueryProvider>
              <InstallPromptProvider>
                {/* The service worker runs in production builds only (e2e uses one too). It
                    caches nothing on its own while browsing and never reloads the page when the
                    connection returns (a half-typed answer must survive). RegisterServiceWorker
                    registers it, so a browser that refuses one isn't reported as a crash. */}
                <SerwistProvider
                  swUrl="/serwist/sw.js"
                  disable={process.env.NODE_ENV !== "production"}
                  register={false}
                  cacheOnNavigation={false}
                  reloadOnOnline={false}
                  options={{ scope: "/" }}
                >
                  <RegisterServiceWorker />
                  <MotionProvider>{children}</MotionProvider>
                  <RemindersCheckIn />
                </SerwistProvider>
              </InstallPromptProvider>
              <Toaster />
              <PageAnalytics />
            </QueryProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
