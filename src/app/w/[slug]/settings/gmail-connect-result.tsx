"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  GMAIL_CONNECT_ERRORS,
  type GmailConnectError,
} from "@/shared/api/sender";

/** The connect failure named by `?gmail_error=` (unknown values read as "failed"). */
function connectError(code: string | null): GmailConnectError | null {
  if (!code) {
    return null;
  }
  return GMAIL_CONNECT_ERRORS.find((value) => value === code) ?? "failed";
}

/** Shows the outcome of the Gmail connect round trip once, then cleans the URL. */
export function GmailConnectResult() {
  const t = useTranslations("Settings.sending");
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Read once: the parameter is removed from the URL right after.
  const [error] = useState(() => connectError(params.get("gmail_error")));
  useEffect(() => {
    const code = params.get("gmail_error");
    const connected = params.get("gmail") === "connected";
    if (!code && !connected) {
      return;
    }
    if (connected) {
      // A fixed id keeps Strict Mode's second effect run from showing it twice.
      toast.success(t("connected"), { id: "gmail-connected" });
    }
    const next = new URLSearchParams(params.toString());
    next.delete("gmail");
    next.delete("gmail_error");
    const query = next.toString();
    router.replace(
      `${pathname}${query ? `?${query}` : ""}${window.location.hash}`,
      { scroll: false },
    );
  }, [params, pathname, router, t]);
  return error ? (
    <p
      role="alert"
      className="rounded-control border-[length:var(--tn-border-width)] border-outline bg-fill-danger p-3 text-sm font-bold text-on-fill"
    >
      {t(`error.${error}`)}
    </p>
  ) : null;
}
