import type { Metadata } from "next";
import { DesignShowcase } from "./design-showcase";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Internal design-system showcase (not linked from the product). */
export default function DesignPage() {
  return <DesignShowcase />;
}
