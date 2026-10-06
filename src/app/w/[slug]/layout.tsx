"use client";

import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/shell/workspace-shell";

/** Every `/w/[slug]` page renders inside the workspace shell. */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  return <WorkspaceShell slug={slug}>{children}</WorkspaceShell>;
}
