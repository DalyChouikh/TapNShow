import type { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/server/supabase/proxy-session";

/** Next 16 proxy (formerly middleware): keeps Supabase sessions fresh. */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
