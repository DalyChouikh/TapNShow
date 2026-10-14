import { MemberShell } from "@/components/shell/member-shell";
import { InvitesView } from "./invites-view";

/** `/invites`: the member home (spec §7.4). */
export default function InvitesPage() {
  return (
    <MemberShell>
      <InvitesView />
    </MemberShell>
  );
}
