import Image from "next/image";

/** The app's mark (the app icon, spec §10 PWA) until the new logo replaces the icon files. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <Image
      src="/icons/icon-192.png"
      alt=""
      width={size}
      height={size}
      unoptimized
      className="shrink-0"
    />
  );
}
