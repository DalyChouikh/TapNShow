"use client";

import { useParams } from "next/navigation";
import { ComingSoon } from "@/components/shell/coming-soon";
import { publicEnv } from "@/config/public-env";
import { MeetingsList } from "./meetings-list";

/** `/w/[slug]/meetings` (spec §10): Upcoming · Drafts · Past. */
export default function MeetingsPage() {
  const { slug } = useParams<{ slug: string }>();
  return publicEnv.NEXT_PUBLIC_MEETINGS_ENABLED ? (
    <MeetingsList slug={slug} />
  ) : (
    <ComingSoon area="meetings" />
  );
}
