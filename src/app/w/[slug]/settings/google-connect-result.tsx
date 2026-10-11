"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  GOOGLE_CONNECT_ERRORS,
  GOOGLE_RESULT_PARAMS,
  type GoogleConnectError,
  type GoogleConnectPurpose,
} from "@/shared/api/google-connect";

/** The connect failure named by `?google_error=` (unknown values read as "failed"). */
function connectError(code: string | null): GoogleConnectError | null {
  if (!code) {
    return null;
  }
  return GOOGLE_CONNECT_ERRORS.find((value) => value === code) ?? "failed";
}

/**
 * Shows the outcome of a Google connect round trip once (a toast, or a plain alert that stays),
 * then removes the result from the URL. Only the banner whose `purpose` the result names reacts,
 * so Sending and Sheets can both sit on the Settings page.
 */
export function GoogleConnectResult({
  purpose,
}: {
  purpose: GoogleConnectPurpose;
}) {
  const sending = useTranslations("Settings.sending");
  const sheets = useTranslations("Settings.sheets");
  const t = purpose === "sheets" ? sheets : sending;
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const mine = params.get(GOOGLE_RESULT_PARAMS.purpose) === purpose;
  // Read once: the parameters are removed from the URL right after.
  const [error] = useState(() =>
    mine ? connectError(params.get(GOOGLE_RESULT_PARAMS.error)) : null,
  );
  useEffect(() => {
    const connected = params.get(GOOGLE_RESULT_PARAMS.done) === "connected";
    if (!mine || (!connected && !params.get(GOOGLE_RESULT_PARAMS.error))) {
      return;
    }
    if (connected) {
      // A fixed id keeps Strict Mode's second effect run from showing it twice.
      toast.success(t("connected"), { id: `google-connected-${purpose}` });
    }
    const next = new URLSearchParams(params.toString());
    Object.values(GOOGLE_RESULT_PARAMS).forEach((key) => next.delete(key));
    const query = next.toString();
    router.replace(
      `${pathname}${query ? `?${query}` : ""}${window.location.hash}`,
      { scroll: false },
    );
  }, [mine, params, pathname, purpose, router, t]);
  return error ? (
    <p
      role="alert"
      className="rounded-control border-[length:var(--tn-border-width)] border-outline bg-fill-danger p-3 text-sm font-bold text-on-fill"
    >
      {t(`error.${error}`)}
    </p>
  ) : null;
}
