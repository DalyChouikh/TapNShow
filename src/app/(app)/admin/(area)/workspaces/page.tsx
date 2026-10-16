"use client";

import { Suspense } from "react";
import { AdminWorkspacesView } from "@/components/admin/admin-workspaces";

/** `/admin/workspaces` (spec §7.19); the view reads its search, filter and sort from the address. */
export default function AdminWorkspacesPage() {
  return (
    <Suspense>
      <AdminWorkspacesView />
    </Suspense>
  );
}
