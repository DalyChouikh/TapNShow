import { describe, expect, it } from "vitest";
import { resolvePostSignInPath } from "./post-sign-in";

const workspace = (slug: string) => ({
  id: crypto.randomUUID(),
  slug,
  name: slug,
  role: "owner" as const,
});

describe("resolvePostSignInPath", () => {
  it("prefers a safe next path", () => {
    expect(
      resolvePostSignInPath(
        { workspaces: [workspace("a-ab12")], lastWorkspaceSlug: "a-ab12" },
        "/invite/tok",
      ),
    ).toBe("/invite/tok");
  });

  it("then the last workspace, then the first one, then creation", () => {
    expect(
      resolvePostSignInPath(
        {
          workspaces: [workspace("a-ab12"), workspace("b-cd34")],
          lastWorkspaceSlug: "b-cd34",
        },
        null,
      ),
    ).toBe("/w/b-cd34");
    expect(
      resolvePostSignInPath(
        { workspaces: [workspace("a-ab12")], lastWorkspaceSlug: null },
        null,
      ),
    ).toBe("/w/a-ab12");
    expect(
      resolvePostSignInPath({ workspaces: [], lastWorkspaceSlug: null }, null),
    ).toBe("/w/new");
  });
});
