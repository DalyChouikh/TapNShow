import { render, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import messages from "../../messages/en.json";
import { DEFAULT_LOCALE } from "@/config/i18n";

/** Renders a component inside the same providers the app uses (i18n; theme added in Task 11). */
export function renderWithProviders(ui: ReactElement): RenderResult {
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}
