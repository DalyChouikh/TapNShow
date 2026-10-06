import { Archivo_Black, Google_Sans, Space_Grotesk } from "next/font/google";

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

/** Google's sign-in button font (branding guidelines: Google Sans Medium 14/20); used only there. */
export const googleSans = Google_Sans({
  weight: "500",
  subsets: ["latin"],
  display: "swap",
  adjustFontFallback: false,
});
