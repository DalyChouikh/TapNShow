/** `loadWorkspaceContext` result for route tests: Owner "me" in workspace "w1". */
export const okContext = {
  ok: true as const,
  supabase: {},
  user: { id: "me", email: null },
  workspace: {
    id: "w1",
    slug: "club-ab12",
    name: "Robotics Club",
    timezone: "Africa/Tunis",
    myRole: "owner" as const,
    canCheckIn: false,
  },
};

/** A same-origin JSON request for route tests. */
export function jsonRequest(method: string, body?: object): Request {
  return new Request("http://localhost:3000/api/x", {
    method,
    headers: { origin: "http://localhost:3000" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
