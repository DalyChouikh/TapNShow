import Image from "next/image";
import { useTranslations } from "next-intl";
import { googleSans } from "@/app/fonts";
import { cn } from "@/lib/utils";

/**
 * "Continue with Google". Google's branding guidelines fix the fill (#FFFFFF light / #131314 dark),
 * the 1px stroke (#747775 / #8E918F), the text color (#1F1F1F / #E3E3E3), Google Sans Medium
 * 14/20, the approved wording, and the standard-color "G" unchanged on white. Everything else
 * follows the app's pressable Neobrutalist buttons: rounded control shape, hard offset shadow,
 * springy lift-and-tilt on hover, shadow collapse on press, no motion for reduced-motion users.
 * These hex values are Google's mandated brand colors, not app tokens.
 */
export function GoogleButton({
  href,
  className,
}: {
  href: string;
  className?: string;
}) {
  const t = useTranslations("Auth");
  return (
    <a
      href={href}
      className={cn(
        googleSans.className,
        "inline-flex min-h-12 w-full items-center justify-center rounded-control border border-[#747775] bg-[#FFFFFF] py-[10px] pr-[12px] pl-[12px] text-[14px] leading-[20px] font-medium text-[#1F1F1F] shadow-brutal transition-[transform,box-shadow] duration-300 ease-spring select-none hover:-translate-y-0.5 hover:-rotate-[1.5deg] hover:shadow-brutal-lg active:translate-y-1 active:rotate-0 active:shadow-none active:duration-75 motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:hover:rotate-0 dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3]",
        className,
      )}
    >
      <span className="mr-[10px] inline-flex rounded-full bg-[#FFFFFF]">
        <Image src="/brand/google-g.svg" alt="" width={20} height={20} />
      </span>
      {t("google")}
    </a>
  );
}
