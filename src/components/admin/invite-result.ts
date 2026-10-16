"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import type { AdminInviteResult } from "@/shared/api/admin";

/**
 * Says what renewing a waiting admin invite did: a link is copied ("Invite link copied"), an email
 * went ("Invite sent again"), or the email couldn't go and Copy link is the way.
 */
export function useInviteResultMessage(): (result: AdminInviteResult) => void {
  const t = useTranslations("Admin.admins");
  const tCommon = useTranslations("Common");
  return (result) => {
    if (result.status === "link" && result.link) {
      void copyText(result.link).then((copied) =>
        copied
          ? toast(t("linkCopied"))
          : toast.error(tCommon("copyLinkFailed")),
      );
    } else if (result.status === "sent") {
      toast(t("resent"));
    } else {
      toast.error(
        result.status === "email_limit" ? t("emailLimit") : t("emailFailed"),
      );
    }
  };
}
