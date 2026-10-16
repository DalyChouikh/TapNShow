import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { PageAnalytics } from "@/components/providers/page-analytics";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { APP_DESCRIPTION, APP_NAME } from "@/config/app";
import { publicEnv } from "@/config/public-env";
import { palette } from "@/design/tokens";
import { archivoBlack, spaceGrotesk } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  // Resolves relative canonical and Open Graph URLs (each page's `alternates.canonical`).
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_APP_URL),
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

/**
 * The message namespaces the public pages' client components use (theme switch, header, FAQ, the
 * error view). The app's pages get every message from `(app)/layout.tsx`.
 */
const PUBLIC_CLIENT_MESSAGES = [
  "Errors",
  "Landing",
  "Public",
  "Theme",
] as const;

/**
 * Root layout: what every page needs, and nothing more, so the public pages (landing, Privacy,
 * Terms, not found) stay light: fonts, theme (no-flash), the public pages' messages and analytics.
 * The app's providers live in `(app)/layout.tsx`.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const messages = await getMessages();
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
        <NextIntlClientProvider
          messages={Object.fromEntries(
            PUBLIC_CLIENT_MESSAGES.map((name) => [name, messages[name]]),
          )}
        >
          <ThemeProvider nonce={nonce}>
            {children}
            <PageAnalytics />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
