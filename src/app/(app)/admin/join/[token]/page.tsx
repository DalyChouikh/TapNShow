import { LegalLine } from "@/components/public/legal-line";
import { AdminJoin } from "./admin-join";

/** `/admin/join/[token]`: accept an admin invite, outside the admin shell (spec §7.19). */
export default function AdminJoinPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <AdminJoin />
      <LegalLine />
    </main>
  );
}
