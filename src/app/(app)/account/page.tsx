import { LegalNav } from "@/components/public/legal-nav";
import { MemberShell } from "@/components/shell/member-shell";
import { contactHref } from "@/config/legal";
import { getServerEnv } from "@/config/env";
import { AccountView } from "./account-view";

/** `/account`: name, Download my answers, Delete my account; Privacy, Terms, Contact (spec §7.4, §7.18). */
export default function AccountPage() {
  return (
    <MemberShell>
      <AccountView />
      <LegalNav
        contact={contactHref(getServerEnv().SMTP_FROM)}
        className="justify-center py-4 text-sm"
      />
    </MemberShell>
  );
}
