"use client";

import { useParams } from "next/navigation";
import { AdminWorkspaceView } from "@/components/admin/admin-workspace";

/** `/admin/workspaces/[id]` (spec §7.19). */
export default function AdminWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  return <AdminWorkspaceView id={id} />;
}
