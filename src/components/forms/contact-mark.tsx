"use client";

import { useTranslations } from "next-intl";
import type { Contact } from "@/shared/api/roster";

/**
 * "Unsubscribed" / "Reported: not my group" next to a person's name. There is no control to clear
 * it: only the person can resubscribe, from their own link (spec §7.16).
 */
export function ContactMark({
  contact,
}: {
  contact: Pick<Contact, "unsubscribed" | "reported">;
}) {
  const t = useTranslations("Lists");
  if (!contact.unsubscribed && !contact.reported) {
    return null;
  }
  return (
    <span className="w-fit rounded-full border-2 border-outline bg-fill-neutral px-2 text-xs font-bold text-on-fill">
      {contact.reported ? t("markReported") : t("markUnsubscribed")}
    </span>
  );
}
