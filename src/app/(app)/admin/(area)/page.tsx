"use client";

import { Suspense } from "react";
import { AdminOverviewView } from "@/components/admin/admin-overview";

/** `/admin`: the Overview (spec §7.19); the view reads its period from the address. */
export default function AdminOverviewPage() {
  return (
    <Suspense>
      <AdminOverviewView />
    </Suspense>
  );
}
