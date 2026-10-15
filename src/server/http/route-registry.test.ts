import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTES, type RouteMethod } from "./route-registry";

const API = join(process.cwd(), "src/app/api");
const METHODS: readonly RouteMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return routeFiles(path);
    }
    return entry.name === "route.ts" ? [path] : [];
  });
}

const files = routeFiles(API).map((path) => ({
  key: relative(API, path).replace(/\/?route\.ts$/, ""),
  source: readFileSync(path, "utf8"),
}));

function exportedMethods(source: string): RouteMethod[] {
  return METHODS.filter((method) =>
    new RegExp(`export (?:async function|const) ${method}\\b`).test(source),
  );
}

describe("route registry (spec §10)", () => {
  it("has exactly one entry per route file and exported method", () => {
    const actual = Object.fromEntries(
      files.map(({ key, source }) => [key, exportedMethods(source)]),
    );
    const registered = Object.fromEntries(
      Object.entries(ROUTES).map(([key, methods]) => [
        key,
        METHODS.filter((method) => methods[method]),
      ]),
    );
    expect(registered).toEqual(actual);
  });

  it("names at least one limit for every method", () => {
    for (const [key, methods] of Object.entries(ROUTES)) {
      for (const [method, entry] of Object.entries(methods)) {
        expect(entry?.limits.length, `${method} ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("says how every GET bounds what it returns, and only GETs", () => {
    for (const [key, methods] of Object.entries(ROUTES)) {
      for (const [method, entry] of Object.entries(methods)) {
        if (method === "GET") {
          expect(entry?.list, `GET ${key}`).toBeDefined();
        } else {
          expect(entry?.list, `${method} ${key}`).toBeUndefined();
        }
      }
    }
  });

  it("pages every paged GET with readPageParams", () => {
    for (const { key, source } of files) {
      if (ROUTES[key]?.GET?.list?.kind === "paged") {
        expect(source, key).toContain("readPageParams(");
      }
    }
  });

  it("finds each route-level limit in its route's source", () => {
    for (const { key, source } of files) {
      for (const entry of Object.values(ROUTES[key] ?? {})) {
        for (const rule of entry?.limits ?? []) {
          if (rule.kind === "ip") {
            expect(source, key).toContain(`checkIpLimit("${rule.action}"`);
          } else if (rule.kind === "token") {
            expect(source, key).toContain("loadTokenContext(");
          } else if (rule.kind === "secret") {
            expect(source, key).toContain("requireInternalSecret(");
          }
        }
      }
    }
  });
});
