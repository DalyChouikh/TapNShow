import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

// The offline page's precache revision: the deployed commit (Vercel sets it), else the local HEAD.
const revision =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  (spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf-8",
  }).stdout.trim() ||
    crypto.randomUUID());

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    additionalPrecacheEntries: [{ url: "/~offline", revision }],
    swSrc: "src/app/sw.ts",
    useNativeEsbuild: true,
  });
