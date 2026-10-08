import { PublicPage } from "@/components/public/public-page";
import { ReportView } from "./report-view";

/** `/report/[token]`: Not my group (spec §7.16). No session needed. */
export default function Page() {
  return (
    <PublicPage>
      <ReportView />
    </PublicPage>
  );
}
