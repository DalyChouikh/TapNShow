import { MemberShell } from "@/components/shell/member-shell";
import { AccountView } from "./account-view";

/** `/account`: name, Download my answers, Delete my account (spec §7.4). */
export default function AccountPage() {
  return (
    <MemberShell>
      <AccountView />
    </MemberShell>
  );
}
