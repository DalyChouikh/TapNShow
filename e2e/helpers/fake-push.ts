import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Port of the fake push service (Web Push, RFC 8030) used by e2e. */
export const FAKE_PUSH_PORT = 44398;
/**
 * Base URL of the fake push service. HTTPS like every real push service: subscriptions must start
 * with https:// (a production rule e2e never weakens).
 */
export const FAKE_PUSH_URL = `https://127.0.0.1:${FAKE_PUSH_PORT}`;

const CERT_DIR = join(tmpdir(), "tapnshow-e2e-push");
/** The throwaway certificate the app trusts in e2e (`NODE_EXTRA_CA_CERTS`). */
export const FAKE_PUSH_CERT = join(CERT_DIR, "cert.pem");
const FAKE_PUSH_KEY = join(CERT_DIR, "key.pem");

/**
 * Creates the fake push service's self-signed certificate (valid for a day, for 127.0.0.1) if it
 * isn't there yet. Runs when the Playwright config loads, because Node reads NODE_EXTRA_CA_CERTS
 * when the app starts.
 */
export function ensureFakePushCertificate(): void {
  if (existsSync(FAKE_PUSH_CERT) && existsSync(FAKE_PUSH_KEY)) {
    return;
  }
  mkdirSync(CERT_DIR, { recursive: true });
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      FAKE_PUSH_KEY,
      "-out",
      FAKE_PUSH_CERT,
    ],
    { stdio: "ignore" },
  );
}

/** Deletes the throwaway certificate (global teardown). */
export function removeFakePushCertificate(): void {
  rmSync(CERT_DIR, { recursive: true, force: true });
}

/** One push the app sent: the encrypted body (base64) and the headers a push service reads. */
export type FakePush = {
  id: string;
  body: string;
  ttl: string | null;
  urgency: string | null;
  topic: string | null;
  authorization: string | null;
};

/**
 * Starts the fake push service: `POST /push/:id` keeps the push and answers 201 (like FCM);
 * `GET /__pushes` lists what arrived.
 */
export function startFakePush(): Promise<Server> {
  ensureFakePushCertificate();
  const pushes: FakePush[] = [];
  const server = createServer(
    { key: readFileSync(FAKE_PUSH_KEY), cert: readFileSync(FAKE_PUSH_CERT) },
    (request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const url = new URL(request.url ?? "/", FAKE_PUSH_URL);
        const id = /^\/push\/([\w-]+)$/.exec(url.pathname)?.[1];
        if (request.method === "POST" && id) {
          const header = (name: string) => {
            const value = request.headers[name];
            return typeof value === "string" ? value : null;
          };
          pushes.push({
            id,
            body: Buffer.concat(chunks).toString("base64"),
            ttl: header("ttl"),
            urgency: header("urgency"),
            topic: header("topic"),
            authorization: header("authorization"),
          });
          response.writeHead(201).end();
          return;
        }
        if (request.method === "GET" && url.pathname === "/__pushes") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(pushes));
          return;
        }
        response.writeHead(404).end();
      });
    },
  );
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(FAKE_PUSH_PORT, "127.0.0.1", () => resolve(server));
  });
}
