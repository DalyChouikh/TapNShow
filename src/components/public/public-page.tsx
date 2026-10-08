import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** Centered single card for the public token pages (no workspace shell, no sign-in). */
export function PublicPage({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4">
      <Card as="section" className="flex flex-col gap-4">
        {children}
      </Card>
    </main>
  );
}
