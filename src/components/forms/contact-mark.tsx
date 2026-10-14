"use client";

import { useTranslations } from "next-intl";
import type { Contact } from "@/shared/api/roster";
import { Pill } from "@/components/ui/pill";

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
    <Pill tone="neutral" className="w-fit">
      {contact.reported ? t("markReported") : t("markUnsubscribed")}
    </Pill>
  );
}
