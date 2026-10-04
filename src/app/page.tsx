import { APP_NAME } from "@/config/app";

/** Temporary landing placeholder until the M9 landing page exists. */
export default function HomePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <h1 className="text-4xl font-bold">{APP_NAME}</h1>
    </main>
  );
}
