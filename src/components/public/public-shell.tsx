import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { getServerEnv } from "@/config/env";
import { contactHref } from "@/config/legal";
import { isSessionCookieName } from "@/server/http/auth-cookie";
import { PublicFooter } from "./public-footer";
import { PublicHeader } from "./public-header";

/**
 * The frame of the public pages (spec §7.18): landing, Privacy, Terms, sign-in, not-found. Knows
 * "signed in" from the session cookie only (no database call).
 */
export async function PublicShell({
  children,
  showSignIn = true,
}: {
  children: ReactNode;
  showSignIn?: boolean;
}) {
  const signedIn = (await cookies())
    .getAll()
    .some((cookie) => isSessionCookieName(cookie.name));
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <PublicHeader signedIn={signedIn} showSignIn={showSignIn} />
      <main className="flex-1">{children}</main>
      <PublicFooter contact={contactHref(getServerEnv().SMTP_FROM)} />
    </div>
  );
}
