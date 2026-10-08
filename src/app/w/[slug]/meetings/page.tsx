"use client";

import { useParams } from "next/navigation";
import { MeetingsList } from "./meetings-list";

/** `/w/[slug]/meetings` (spec §10): Upcoming · Drafts · Past. */
export default function MeetingsPage() {
  const { slug } = useParams<{ slug: string }>();
  return <MeetingsList slug={slug} />;
}
