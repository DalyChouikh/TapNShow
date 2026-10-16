import { describe, expect, it } from "vitest";
import { dumpCounts } from "./dump-counts";

const data = [
  "SET statement_timeout = 0;",
  'COPY "public"."contacts" ("id", "full_name") FROM stdin;',
  "1\tAmira",
  "2\tLine one\\nline two",
  "\\.",
  "",
  'COPY "public"."lists" ("id") FROM stdin;',
  "\\.",
  "",
].join("\n");
const history = [
  'COPY "supabase_migrations"."schema_migrations" ("version") FROM stdin;',
  "20261006080206",
  "20261016150906",
  "\\.",
].join("\n");
const authTriggers = [
  "CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();",
  "CREATE TRIGGER on_auth_identity_google_created AFTER INSERT ON auth.identities FOR EACH ROW EXECUTE FUNCTION private.x();",
  "",
].join("\n");

describe("dumpCounts", () => {
  it("counts each table's rows in the dump itself (one snapshot), empty tables too", () => {
    expect(
      dumpCounts({ data, history, authTriggers }, [
        "public.contacts",
        "public.lists",
        "supabase_migrations.schema_migrations",
        "auth.triggers (ours)",
      ]),
    ).toBe(
      "public.contacts|2\npublic.lists|0\nsupabase_migrations.schema_migrations|2\nauth.triggers (ours)|2\n",
    );
  });

  it("marks a table the dump doesn't have, so the check fails", () => {
    expect(
      dumpCounts({ data, history, authTriggers }, ["public.platform_events"]),
    ).toBe("public.platform_events|missing\n");
  });
});
