import { AdminShell } from "@/components/admin/admin-shell";

/**
 * The admin pages (spec §7.19) inside the admin shell. A route group: the URLs stay `/admin/…`,
 * and `/admin/join/[token]` (the invite, for someone not yet an admin) sits outside it. Never
 * indexed, like every app page (`(app)/layout.tsx`).
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <AdminShell>{children}</AdminShell>;
}
