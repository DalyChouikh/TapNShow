import { describe, expect, it } from "vitest";
import { homeWorkspaceSlug, resolvePostSignInPath } from "./post-sign-in";

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

  it("then the last workspace, then the first one, then the member home", () => {
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
    ).toBe("/invites");
  });
});

describe("homeWorkspaceSlug", () => {
  it("is the last workspace, else the first, else none", () => {
    expect(
      homeWorkspaceSlug({
        workspaces: [workspace("a-ab12"), workspace("b-cd34")],
        lastWorkspaceSlug: "b-cd34",
      }),
    ).toBe("b-cd34");
    expect(
      homeWorkspaceSlug({
        workspaces: [workspace("a-ab12")],
        lastWorkspaceSlug: null,
      }),
    ).toBe("a-ab12");
    expect(
      homeWorkspaceSlug({ workspaces: [], lastWorkspaceSlug: null }),
    ).toBeNull();
  });
});
