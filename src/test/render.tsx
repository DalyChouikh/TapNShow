import { render, type RenderResult, screen } from "@testing-library/react";
import { expect } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import messages from "../../messages/en.json";
import { MotionProvider } from "@/components/motion/motion-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { DEFAULT_LOCALE } from "@/config/i18n";

/**
 * Renders a component inside the same providers the app uses (i18n + theme + motion); `rerender`
 * keeps them.
 * @param options.toaster - also mount sonner's Toaster, for tests that assert toasts
 */
export function renderWithProviders(
  ui: ReactElement,
  options: { toaster?: boolean } = {},
): RenderResult {
  // A wrapper (not a parent element), so `rerender` keeps the providers.
  function Providers({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
        <ThemeProvider>
          <QueryProvider>
            <MotionProvider>
              {children}
              {options.toaster ? <Toaster /> : null}
            </MotionProvider>
          </QueryProvider>
        </ThemeProvider>
      </NextIntlClientProvider>
    );
  }
  return render(ui, { wrapper: Providers });
}

/**
 * Asserts a component rendered nothing a person could see or use. The providers add their own
 * markup (the theme script), so an empty container is no test.
 */
export function expectNothingShown(): void {
  for (const role of ["heading", "button", "switch", "status"] as const) {
    expect(screen.queryByRole(role)).toBeNull();
  }
}
