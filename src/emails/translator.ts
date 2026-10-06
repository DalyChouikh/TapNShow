import { createTranslator } from "next-intl";
import { DEFAULT_LOCALE } from "@/config/i18n";
import messages from "../../messages/en.json";

/** Translator for the `Email` namespace, usable outside React (routes, scripts). */
export function getEmailTranslator() {
  return createTranslator({
    locale: DEFAULT_LOCALE,
    messages,
    namespace: "Email",
  });
}
