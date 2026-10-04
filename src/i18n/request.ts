import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE } from "@/config/i18n";

/** Locale is not in the URL; it will come from user/workspace settings starting in M2. */
export default getRequestConfig(async () => {
  const locale = DEFAULT_LOCALE;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
