import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";

/** The admin area is never indexed. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The admin pages (spec §7.19) inside the admin shell. A route group: the URLs stay `/admin/…`,
 * and `/admin/join/[token]` (the invite, for someone not yet an admin) sits outside it.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <AdminShell>{children}</AdminShell>;
}
