import { PublicPage } from "@/components/public/public-page";
import { ResponsePlaceholder } from "./response-placeholder";

/** `/r/[token]`: Personal answer link; the form arrives in M5. No session needed. */
export default function Page() {
  return (
    <PublicPage>
      <ResponsePlaceholder />
    </PublicPage>
  );
}
