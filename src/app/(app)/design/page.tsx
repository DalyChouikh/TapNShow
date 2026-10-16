import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getServerEnv } from "@/config/env";
import { isProductionDeployment } from "@/lib/deployment";
import { DesignShowcase } from "./design-showcase";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Internal design-system showcase (not linked from the product; not found on production, M9). */
export default function DesignPage() {
  if (isProductionDeployment(getServerEnv().VERCEL_ENV)) {
    notFound();
  }
  return <DesignShowcase />;
}
