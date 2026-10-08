import { PublicPage } from "@/components/public/public-page";
import { UnsubscribeView } from "./unsubscribe-view";

/** `/u/[token]`: Unsubscribe from one workspace (spec §7.16). No session needed. */
export default function Page() {
  return (
    <PublicPage>
      <UnsubscribeView />
    </PublicPage>
  );
}
