import { render, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import messages from "../../messages/en.json";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { DEFAULT_LOCALE } from "@/config/i18n";

/** Renders a component inside the same providers the app uses (i18n + theme). */
export function renderWithProviders(ui: ReactElement): RenderResult {
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      <ThemeProvider>{ui}</ThemeProvider>
    </NextIntlClientProvider>,
  );
}
