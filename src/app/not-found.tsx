import { cookies } from "next/headers";
import { NotFoundView } from "@/components/errors/not-found-view";
import { PublicPage } from "@/components/public/public-page";
import { isSessionCookieName } from "@/server/http/auth-cookie";

/** Root not-found (spec §7.18). Reads the session cookie only: no database call for a 404. */
export default async function NotFound() {
  const signedIn = (await cookies())
    .getAll()
    .some((cookie) => isSessionCookieName(cookie.name));
  return (
    <PublicPage>
      <NotFoundView signedIn={signedIn} />
    </PublicPage>
  );
}
