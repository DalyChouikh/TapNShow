import { describe, expect, it } from "vitest";
import { z } from "zod";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";

const one = <T extends z.ZodTypeAny>(row: T) => z.array(row).length(1);

describe("housekeeping (spec §8)", () => {
  it("installs pg_net outside public and pg_cron", () => {
    const rows = queryLocalSql(
      `select e.extname as name, n.nspname as schema from pg_extension e
       join pg_namespace n on n.oid = e.extnamespace
       where e.extname in ('pg_cron', 'pg_net') order by 1`,
      z.array(z.object({ name: z.string(), schema: z.string() })),
    );
    expect(rows.map((row) => row.name)).toEqual(["pg_cron", "pg_net"]);
    expect(rows.find((row) => row.name === "pg_net")?.schema).toBe(
      "extensions",
    );
  });

  it("schedules the daily job", () => {
    const [job] = queryLocalSql(
      "select schedule, command from cron.job where jobname = 'tn-housekeeping'",
      one(z.object({ schedule: z.string(), command: z.string() })),
    );
    expect(job.schedule).toBe("17 3 * * *");
    expect(job.command).toContain("private.housekeeping()");
  });

  it("deletes rate-limit events older than two days and keeps recent ones", () => {
    const key = `housekeeping-test:${crypto.randomUUID()}`;
    runLocalSql(
      `insert into private.rate_limit_events (key, occurred_at) values
         ('${key}', now() - interval '3 days'),
         ('${key}', now() - interval '47 hours'),
         ('${key}', now())`,
    );
    runLocalSql("select private.housekeeping()");
    const [left] = queryLocalSql(
      `select count(*)::int as n from private.rate_limit_events where key = '${key}'`,
      one(z.object({ n: z.number() })),
    );
    expect(left.n).toBe(2);
  });

  it("is not executable by API roles", () => {
    const [row] = queryLocalSql(
      `select has_function_privilege('authenticated', 'private.housekeeping()', 'EXECUTE') as a,
              has_function_privilege('anon', 'private.housekeeping()', 'EXECUTE') as b,
              has_function_privilege('service_role', 'private.housekeeping()', 'EXECUTE') as c`,
      one(z.object({ a: z.boolean(), b: z.boolean(), c: z.boolean() })),
    );
    expect(row).toEqual({ a: false, b: false, c: false });
  });
});
