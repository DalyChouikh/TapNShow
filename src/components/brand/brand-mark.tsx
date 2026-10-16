import { appIconSvg } from "@/lib/brand/app-icon";
import { cn } from "@/lib/utils";

/** The app icon's drawing (the same SVG the icon files are made from). */
const MARK_SVG = appIconSvg("full");

/**
 * The app's mark (the app icon, spec §10 PWA), drawn inline: sharp at any pixel density, no image
 * request and no image component script on the public pages. Decorative: the brand name is next to it.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-8 shrink-0 [&>svg]:size-full",
        className,
      )}
      // A constant we generate (app-icon.ts), never user input.
      dangerouslySetInnerHTML={{ __html: MARK_SVG }}
    />
  );
}
