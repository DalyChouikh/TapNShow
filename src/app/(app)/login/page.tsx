import { Suspense } from "react";
import { PublicShell } from "@/components/public/public-shell";
import { LoginScreen } from "./login-screen";

/**
 * `/login`, inside the public shell (no Sign in button there). `useSearchParams` needs a Suspense
 * boundary.
 */
export default function LoginPage() {
  return (
    <PublicShell showSignIn={false}>
      <div className="mx-auto flex max-w-md flex-col justify-center p-4 py-10">
        <Suspense>
          <LoginScreen />
        </Suspense>
      </div>
    </PublicShell>
  );
}
