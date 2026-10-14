import { createECDH, randomBytes, type ECDH } from "node:crypto";
import { readFileSync } from "node:fs";
import { get } from "node:https";
import { decrypt } from "http_ece";
import { z } from "zod";
import { adminClient } from "./admin";
import { FAKE_PUSH_CERT, FAKE_PUSH_URL, type FakePush } from "./fake-push";

/** Test-only VAPID keys (like E2E_TOKEN_KEY); production keys are never in the repo. */
export const E2E_VAPID = {
  publicKey:
    "BIEnKZ5jVCItxLYghU8mqqE-iHIFX_1UceU9FFzZJsNjXaCFSaegpgULPDm24uHTmuL8noKA1bAok5NE2QRC028",
  privateKey: "5Bu8QiGuWxD_QfYVoEWW8ZvionpG1NCoEsBlcmWKd-s",
  subject: "mailto:e2e@example.test",
};

/** A browser's push keys: the ECDH P-256 pair and the 16-byte auth secret (RFC 8291). */
export type BrowserKeys = { ecdh: ECDH; p256dh: string; auth: string };

/** New push keys for one fake browser. */
export function newBrowserKeys(): BrowserKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    ecdh,
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
}

/**
 * Subscribes `userId` with a fake browser whose pushes land in the fake push service under `id`
 * (service role: the browser side of subscribing is unit-tested).
 */
export async function seedPushSubscription(
  userId: string,
  keys: BrowserKeys,
  id: string,
): Promise<void> {
  const { error } = await adminClient()
    .from("push_subscriptions")
    .insert({
      user_id: userId,
      endpoint: `${FAKE_PUSH_URL}/push/${id}`,
      p256dh: keys.p256dh,
      auth: keys.auth,
    });
  if (error) {
    throw error;
  }
}

const pushListSchema = z.array(
  z.object({
    id: z.string(),
    body: z.string(),
    ttl: z.string().nullable(),
    urgency: z.string().nullable(),
    topic: z.string().nullable(),
    authorization: z.string().nullable(),
  }),
);

/** The pushes the fake service received for one fake browser. */
export function pushesFor(id: string): Promise<FakePush[]> {
  return new Promise((resolve, reject) => {
    get(
      `${FAKE_PUSH_URL}/__pushes`,
      { ca: readFileSync(FAKE_PUSH_CERT) },
      (response) => {
        let text = "";
        response.on("data", (chunk: Buffer) => {
          text += chunk.toString("utf8");
        });
        response.on("end", () =>
          resolve(
            pushListSchema
              .parse(JSON.parse(text))
              .filter((push) => push.id === id),
          ),
        );
      },
    ).on("error", reject);
  });
}

/** What a notification says once decrypted with the fake browser's keys. */
export function decryptPush(push: FakePush, keys: BrowserKeys): string {
  return decrypt(Buffer.from(push.body, "base64"), {
    version: "aes128gcm",
    privateKey: keys.ecdh,
    authSecret: keys.auth,
  }).toString("utf8");
}
