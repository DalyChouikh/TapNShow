import { MemberShell } from "@/components/shell/member-shell";
import { OpenInvite } from "./open-invite";

/**
 * `/invites/[id]`: opens one of the signed-in person's invites on its answer page (spec §7.4;
 * notifications link here, never to a personal link).
 */
export default async function OpenInvitePage({
  params,
}: PageProps<"/invites/[id]">) {
  const { id } = await params;
  return (
    <MemberShell>
      <OpenInvite id={id} />
    </MemberShell>
  );
}
