import { LegalLine } from "@/components/public/legal-line";
import { InviteAcceptance } from "./invite-acceptance";

/** `/invite/[token]`: sign in first, then accept (spec §7.13). */
export default function InvitePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <InviteAcceptance />
      <LegalLine />
    </main>
  );
}
