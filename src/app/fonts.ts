import { Archivo_Black, Space_Grotesk } from "next/font/google";
import localFont from "next/font/local";

/** Display font for headings (Neobrutalist weight). */
export const archivoBlack = Archivo_Black({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-archivo-black",
  display: "swap",
});

/** Body font. */
export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

/**
 * Google's sign-in button font (branding guidelines: Google Sans Medium 14/20); used only there.
 * Declared here, with the root layout's fonts, so its rule joins the global stylesheet: a module
 * of its own would give `/login` a stylesheet that every prefetched sign-in link preloads unused.
 * Not preloaded: the browser downloads it only when the button shows. Self-hosted (OFL,
 * `src/assets/fonts/OFL-google-sans.txt`): Turbopack's Google loader has no fallback metrics for
 * it and warns on every build.
 */
export const googleSans = localFont({
  src: "../assets/fonts/google-sans-500-latin.woff2",
  weight: "500",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});
