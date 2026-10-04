/** Locales with complete translations. Add "fr"/"ar" here when their messages exist. */
export const SUPPORTED_LOCALES = ["en"] as const;

/** A supported locale code. */
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Locale used when no supported preference is known. */
export const DEFAULT_LOCALE: Locale = "en";

/**
 * Maps a stored preference (user or workspace setting) to a supported locale.
 * @param candidate - locale code from settings, possibly unsupported or missing
 */
export function resolveLocale(candidate: string | null | undefined): Locale {
  return (
    SUPPORTED_LOCALES.find((locale) => locale === candidate) ?? DEFAULT_LOCALE
  );
}
