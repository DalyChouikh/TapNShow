import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { LegalLine } from "./legal-line";

/** Centered single card for the public token pages (no workspace shell, no sign-in). */
export function PublicPage({
  children,
  legalLine = false,
}: {
  children: ReactNode;
  /** "Sent with TapNShow · Privacy · Terms" under the card: the pages a group's emails link to. */
  legalLine?: boolean;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <Card as="section" className="flex flex-col gap-4">
        {children}
      </Card>
      {legalLine ? <LegalLine /> : null}
    </main>
  );
}
