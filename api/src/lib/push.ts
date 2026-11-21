import { readFileSync } from "node:fs";

import { PUSH_ANDROID_CHANNEL_ID } from "@smart-waste/shared";
import { cert, initializeApp, type App } from "firebase-admin/app";
import { getMessaging, type Message, type Messaging } from "firebase-admin/messaging";

import type { Env } from "../env.js";
import type { Logger } from "./logger.js";

/** One push message to one device. `data` values must be strings (an FCM rule). */
export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface PushSendResult {
  token: string;
  ok: boolean;
  /**
   * The token can never work again (the app was uninstalled, the token was
   * rolled, or it belongs to another Firebase project). The caller removes it.
   */
  invalidToken: boolean;
  error?: string;
}

/** Sends push messages. Kept behind an interface so tests and unconfigured setups need no Firebase. */
export interface PushSender {
  /** Short name for logs: "fcm" or "disabled". */
  readonly kind: string;
  send(messages: PushMessage[]): Promise<PushSendResult[]>;
}

/** Used when no Firebase key is configured: nothing is sent, nothing fails. */
export class DisabledPushSender implements PushSender {
  readonly kind = "disabled";

  async send(messages: PushMessage[]): Promise<PushSendResult[]> {
    return messages.map((message) => ({
      token: message.token,
      ok: false,
      invalidToken: false,
      error: "Push notifications are not configured on this server",
    }));
  }
}

/** FCM error codes that mean the token itself is dead, not that the send failed for now. */
const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/sender-id-mismatch",
]);

/** `sendEach` accepts at most 500 messages per call. */
const FCM_BATCH_SIZE = 500;

function isInvalidTokenError(code: string | undefined, message: string | undefined): boolean {
  if (!code) return false;
  if (INVALID_TOKEN_CODES.has(code)) return true;
  // A malformed token is reported as a generic invalid argument that names the token.
  return code === "messaging/invalid-argument" && /registration token/i.test(message ?? "");
}

/** Firebase Cloud Messaging through the official Admin SDK (HTTP v1 API). */
export class FcmPushSender implements PushSender {
  readonly kind = "fcm";
  private readonly messaging: Messaging;

  constructor(serviceAccount: object) {
    const app: App = initializeApp({ credential: cert(serviceAccount as Parameters<typeof cert>[0]) }, "smart-waste-push");
    this.messaging = getMessaging(app);
  }

  async send(messages: PushMessage[]): Promise<PushSendResult[]> {
    const results: PushSendResult[] = [];
    for (let start = 0; start < messages.length; start += FCM_BATCH_SIZE) {
      const batch = messages.slice(start, start + FCM_BATCH_SIZE);
      const response = await this.messaging.sendEach(batch.map(toFcmMessage));
      response.responses.forEach((item, index) => {
        const token = batch[index]!.token;
        if (item.success) {
          results.push({ token, ok: true, invalidToken: false });
          return;
        }
        const code = item.error?.code;
        const errorMessage = item.error?.message;
        results.push({
          token,
          ok: false,
          invalidToken: isInvalidTokenError(code, errorMessage),
          error: code ? `${code}: ${errorMessage ?? ""}`.trim() : (errorMessage ?? "Unknown FCM error"),
        });
      });
    }
    return results;
  }
}

function toFcmMessage(message: PushMessage): Message {
  return {
    token: message.token,
    notification: { title: message.title, body: message.body },
    data: message.data,
    android: {
      priority: "high",
      notification: { channelId: PUSH_ANDROID_CHANNEL_ID, sound: "default" },
    },
    apns: { payload: { aps: { sound: "default" } } },
  };
}

/**
 * Picks the sender from the environment: the Firebase key as a file path or as
 * inline JSON, otherwise a disabled sender. A wrong key is reported clearly
 * and push is simply switched off — the rest of the API keeps working.
 */
export function createPushSender(env: Env, logger: Logger): PushSender {
  const source = env.FIREBASE_SERVICE_ACCOUNT_FILE
    ? { where: env.FIREBASE_SERVICE_ACCOUNT_FILE, text: () => readFileSync(env.FIREBASE_SERVICE_ACCOUNT_FILE!, "utf8") }
    : env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? { where: "FIREBASE_SERVICE_ACCOUNT_JSON", text: () => env.FIREBASE_SERVICE_ACCOUNT_JSON! }
      : null;

  if (!source) {
    logger.warn(
      "Push notifications are disabled: set FIREBASE_SERVICE_ACCOUNT_FILE (or FIREBASE_SERVICE_ACCOUNT_JSON) to enable them",
    );
    return new DisabledPushSender();
  }

  try {
    const parsed = JSON.parse(source.text()) as { project_id?: unknown; client_email?: unknown; private_key?: unknown };
    if (typeof parsed.project_id !== "string" || typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
      throw new Error("the JSON is not a Firebase service-account key (project_id, client_email and private_key expected)");
    }
    logger.info({ projectId: parsed.project_id, source: source.where }, "Push notifications enabled (Firebase Cloud Messaging)");
    return new FcmPushSender(parsed);
  } catch (error) {
    logger.error({ err: error, source: source.where }, "Could not load the Firebase service-account key; push notifications are disabled");
    return new DisabledPushSender();
  }
}
