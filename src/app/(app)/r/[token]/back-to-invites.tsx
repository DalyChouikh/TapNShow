"use client";

import { ArrowLeft } from "@phosphor-icons/react";
import Link from "next/link";
import { useTranslations } from "next-intl";

/** On the invite's own account: the way back to all of the person's invites (spec §7.4). */
export function BackToInvites() {
  const t = useTranslations("AnswerPage");
  return (
    <Link
      href="/invites"
      className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-bold underline"
    >
      <ArrowLeft weight="bold" aria-hidden />
      {t("backToInvites")}
    </Link>
  );
}
