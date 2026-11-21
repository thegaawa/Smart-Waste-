import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Priority, Role, UserStatus, type AuthResponse } from "@smart-waste/shared";
import type { Express } from "express";
import { pino } from "pino";
import request from "supertest";
import { afterAll, beforeEach } from "vitest";

import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { hashPassword } from "../src/lib/password.js";
import type { PushMessage, PushSender, PushSendResult } from "../src/lib/push.js";
import { LocalDiskStorage } from "../src/lib/storage.js";
import { PushService } from "../src/modules/push/service.js";

export { prisma };

const tempUploadDirs: string[] = [];

/** Photo storage in a throwaway folder, removed when the test file finishes. */
export function makeStorage(): LocalDiskStorage {
  const dir = mkdtempSync(path.join(tmpdir(), "smart-waste-test-uploads-"));
  tempUploadDirs.push(dir);
  return new LocalDiskStorage(dir);
}

/** Records every push message instead of calling Firebase. Tokens in `deadTokens` are reported as invalid. */
export class FakePushSender implements PushSender {
  readonly kind = "fake";
  readonly sent: PushMessage[] = [];
  readonly deadTokens = new Set<string>();
  /** When set, `send` rejects with this error (simulates a Firebase outage). */
  failWith: Error | null = null;

  async send(messages: PushMessage[]): Promise<PushSendResult[]> {
    if (this.failWith) throw this.failWith;
    this.sent.push(...messages);
    return messages.map((message) => ({
      token: message.token,
      ok: !this.deadTokens.has(message.token),
      invalidToken: this.deadTokens.has(message.token),
      ...(this.deadTokens.has(message.token) ? { error: "messaging/registration-token-not-registered" } : {}),
    }));
  }
}

export function makeApp(storage: LocalDiskStorage = makeStorage(), push?: PushService): Express {
  return createApp({ db: prisma, logger: pino({ level: "silent" }), storage, ...(push ? { push } : {}) });
}

/** An app whose push messages are captured by a fake sender; `await push.settle()` before asserting. */
export function makeAppWithPush(): { app: Express; sender: FakePushSender; push: PushService } {
  const sender = new FakePushSender();
  const push = new PushService(prisma, sender, pino({ level: "silent" }));
  return { app: makeApp(makeStorage(), push), sender, push };
}

/** Empties every table. Order does not matter thanks to CASCADE. */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "notifications", "status_history", "assignments", "report_media",
     "waste_reports", "refresh_tokens", "push_devices", "users", "categories" RESTART IDENTITY CASCADE`,
  );
  await prisma.$executeRawUnsafe(`ALTER SEQUENCE "report_reference_seq" RESTART WITH 1000`);
}

/** Call once at the top of a test file: clean database before each test, disconnect at the end. */
export function useTestDb(): void {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    for (const dir of tempUploadDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
}

export interface TestUserInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  password?: string;
  role?: Role;
  status?: UserStatus;
}

export const DEFAULT_PASSWORD = "Password123!";

let userCounter = 0;

export async function createUser(input: TestUserInput = {}) {
  userCounter += 1;
  const role = input.role ?? Role.CITIZEN;
  const email = input.email === undefined ? `${role.toLowerCase()}${userCounter}@test.local` : input.email;
  return prisma.user.create({
    data: {
      name: input.name ?? `Test ${role} ${userCounter}`,
      email,
      phone: input.phone ?? null,
      passwordHash: await hashPassword(input.password ?? DEFAULT_PASSWORD),
      role,
      status: input.status ?? UserStatus.ACTIVE,
    },
  });
}

export async function login(app: Express, identifier: string, password = DEFAULT_PASSWORD): Promise<AuthResponse> {
  const res = await request(app).post("/auth/login").send({ identifier, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${identifier}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as AuthResponse;
}

/** Creates a user with the given role and returns a ready-to-use Bearer header. */
export async function authHeaderFor(app: Express, role: Role): Promise<{ Authorization: string }> {
  const user = await createUser({ role });
  const auth = await login(app, user.email as string);
  return { Authorization: `Bearer ${auth.accessToken}` };
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export async function createCategory(name: string, active = true, defaultPriority: Priority = Priority.MEDIUM) {
  return prisma.category.create({ data: { name, active, defaultPriority } });
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** Smallest byte sequences the API recognises as images (it checks the magic bytes only). */
export const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from("JFIF\0"),
  Buffer.alloc(64, 0x11),
  Buffer.from([0xff, 0xd9]),
]);
export const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 0x22)]);

/** A valid report body (Ikeja, Lagos). Override any field per test. */
export function reportFields(categoryId: string, overrides: Record<string, string | number | undefined> = {}) {
  return {
    categoryId,
    description: "Refuse heap blocking the drainage beside the bus stop",
    latitude: 6.6018,
    longitude: 3.3515,
    address: "Obafemi Awolowo Way, Ikeja",
    ...overrides,
  };
}

export interface PhotoAttachment {
  data: Buffer;
  filename?: string;
  contentType?: string;
}

/**
 * POST /reports. With photos the request is multipart/form-data (as the app
 * sends it); without photos it is plain JSON.
 */
export function postReport(
  app: Express,
  auth: { Authorization: string },
  fields: Record<string, string | number | undefined>,
  photos: PhotoAttachment[] = [],
) {
  const req = request(app).post("/reports").set(auth);
  if (photos.length === 0) return req.send(fields);
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) req.field(key, String(value));
  }
  for (const photo of photos) {
    req.attach("photos", photo.data, {
      filename: photo.filename ?? "photo.jpg",
      contentType: photo.contentType ?? "image/jpeg",
    });
  }
  return req;
}
