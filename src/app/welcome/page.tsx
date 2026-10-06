import { Suspense } from "react";
import { WelcomeFlow } from "./welcome-flow";

/** `/welcome` — `useSearchParams` needs a Suspense boundary for static rendering. */
export default function WelcomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4">
      <Suspense>
        <WelcomeFlow />
      </Suspense>
    </main>
  );
}
