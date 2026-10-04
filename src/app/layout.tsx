import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { APP_DESCRIPTION, APP_NAME } from "@/config/app";
import { publicEnv } from "@/config/public-env";
import { archivoBlack, spaceGrotesk } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  verification: publicEnv.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: publicEnv.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
    : undefined,
};

/** Root layout: fonts, theme (no-flash), and i18n providers. */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${archivoBlack.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <NextIntlClientProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
