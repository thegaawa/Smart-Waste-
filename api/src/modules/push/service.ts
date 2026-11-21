import type { PushMessageData } from "@smart-waste/shared";

import type { Db } from "../../db.js";
import type { Logger } from "../../lib/logger.js";
import type { PushMessage, PushSender } from "../../lib/push.js";
import type { AuthenticatedUser } from "../../middleware/auth.js";
import type { RegisterDeviceInput, UnregisterDeviceInput } from "./schemas.js";

/** Title shown above every push message; the body is the in-app notification text. */
export const PUSH_TITLE = "Smart-Waste";

/**
 * One notification that was just written to the database and should also
 * reach the user's phone(s). `body` is the same text the app shows in its
 * notification list, so the tray and the app never disagree.
 */
export interface PushEvent {
  userId: string;
  body: string;
  reportId: string | null;
  reference?: string;
}

/**
 * Push notifications (Chapter 4.3.5). Registers devices and, after a
 * notification row is committed, sends the same message to the user's phones.
 *
 * Sending is deliberately outside the database transaction and never awaited
 * by the request: a slow or failing Firebase call must not delay or fail a
 * status change. Dead tokens reported by Firebase are removed.
 */
export class PushService {
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly sender: PushSender,
    private readonly logger: Logger,
  ) {}

  /** True when a Firebase key is configured; the app can show this in diagnostics. */
  get enabled(): boolean {
    return this.sender.kind !== "disabled";
  }

  /**
   * Registers (or refreshes) a device for the signed-in user. A token that
   * was registered by another account on the same phone moves to this user.
   */
  async registerDevice(user: AuthenticatedUser, input: RegisterDeviceInput): Promise<void> {
    await this.db.pushDevice.upsert({
      where: { token: input.token },
      create: { userId: user.id, token: input.token, platform: input.platform, appVersion: input.appVersion ?? null },
      update: { userId: user.id, platform: input.platform, appVersion: input.appVersion ?? null },
    });
  }

  /** Removes the device if it belongs to this user (sign out). Unknown tokens are fine. */
  async unregisterDevice(user: AuthenticatedUser, input: UnregisterDeviceInput): Promise<void> {
    await this.db.pushDevice.deleteMany({ where: { token: input.token, userId: user.id } });
  }

  /** Queues push messages for the given events. Returns at once; see `settle`. */
  dispatch(events: PushEvent[]): void {
    if (events.length === 0) return;
    const job = this.deliver(events)
      .catch((error: unknown) => {
        this.logger.error({ err: error }, "Push delivery failed");
      })
      .finally(() => {
        this.inFlight.delete(job);
      });
    this.inFlight.add(job);
  }

  /** Waits for every queued delivery to finish (tests and graceful shutdown). */
  async settle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  private async deliver(events: PushEvent[]): Promise<void> {
    const userIds = [...new Set(events.map((event) => event.userId))];
    const devices = await this.db.pushDevice.findMany({
      where: { userId: { in: userIds } },
      select: { token: true, userId: true },
    });
    if (devices.length === 0) return;

    const messages: PushMessage[] = [];
    for (const event of events) {
      const data: Record<string, string> = {};
      const payload: PushMessageData = {
        ...(event.reportId ? { reportId: event.reportId } : {}),
        ...(event.reference ? { reference: event.reference } : {}),
      };
      for (const [key, value] of Object.entries(payload)) if (value !== undefined) data[key] = value;

      for (const device of devices) {
        if (device.userId !== event.userId) continue;
        messages.push({ token: device.token, title: PUSH_TITLE, body: event.body, data });
      }
    }
    if (messages.length === 0) return;

    const results = await this.sender.send(messages);

    const dead = [...new Set(results.filter((result) => result.invalidToken).map((result) => result.token))];
    if (dead.length > 0) {
      await this.db.pushDevice.deleteMany({ where: { token: { in: dead } } });
    }

    const sent = results.filter((result) => result.ok).length;
    const failed = results.length - sent;
    const summary = { sender: this.sender.kind, sent, failed, removedTokens: dead.length, users: userIds.length };
    if (this.sender.kind === "disabled") {
      this.logger.debug(summary, "Push skipped: notifications are in-app only until Firebase is configured");
    } else if (failed > 0) {
      this.logger.warn({ ...summary, errors: results.filter((r) => !r.ok).map((r) => r.error) }, "Some push messages were not delivered");
    } else {
      this.logger.info(summary, "Push messages sent");
    }
  }
}
