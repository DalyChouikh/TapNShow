import { render, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import messages from "../../messages/en.json";
import { MotionProvider } from "@/components/motion/motion-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { DEFAULT_LOCALE } from "@/config/i18n";

/**
 * Renders a component inside the same providers the app uses (i18n + theme + motion).
 * @param options.toaster - also mount sonner's Toaster, for tests that assert toasts
 */
export function renderWithProviders(
  ui: ReactElement,
  options: { toaster?: boolean } = {},
): RenderResult {
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      <ThemeProvider>
        <QueryProvider>
          <MotionProvider>
            {ui}
            {options.toaster ? <Toaster /> : null}
          </MotionProvider>
        </QueryProvider>
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}
