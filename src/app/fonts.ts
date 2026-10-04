import { Archivo_Black, Space_Grotesk } from "next/font/google";

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
