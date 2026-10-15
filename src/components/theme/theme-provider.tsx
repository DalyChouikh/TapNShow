"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Applies `data-theme` on <html> before paint (no flash) and follows the OS by default. The nonce
 * is this request's CSP nonce (root layout): the no-flash script is inline.
 */
export function ThemeProvider({
  nonce,
  children,
}: {
  nonce?: string;
  children: ReactNode;
}) {
  return (
    <NextThemesProvider
      nonce={nonce}
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
