import { Suspense } from "react";
import { LoginScreen } from "./login-screen";

/** `/login` — `useSearchParams` needs a Suspense boundary for static rendering. */
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4">
      <Suspense>
        <LoginScreen />
      </Suspense>
    </main>
  );
}
