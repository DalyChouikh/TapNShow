import { cookies } from "next/headers";
import { NotFoundView } from "@/components/errors/not-found-view";
import { PublicShell } from "@/components/public/public-shell";
import { Card } from "@/components/ui/card";
import { isSessionCookieName } from "@/server/http/auth-cookie";

/**
 * Root not-found (spec §7.18), inside the public shell. Reads the session cookie only: no database
 * call for a 404 (`cookies()` is read once per request, so the shell's own read costs nothing).
 */
export default async function NotFound() {
  const signedIn = (await cookies())
    .getAll()
    .some((cookie) => isSessionCookieName(cookie.name));
  return (
    <PublicShell>
      <div className="px-4 py-10">
        <Card as="section" className="mx-auto flex max-w-md flex-col gap-4">
          <NotFoundView signedIn={signedIn} />
        </Card>
      </div>
    </PublicShell>
  );
}
