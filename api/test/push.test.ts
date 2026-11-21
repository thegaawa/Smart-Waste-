import { Priority, ReportStatus, Role, type ReportDetailDto } from "@smart-waste/shared";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { PUSH_TITLE } from "../src/modules/push/service.js";
import {
  bearer,
  createCategory,
  createUser,
  login,
  makeAppWithPush,
  postReport,
  prisma,
  reportFields,
  useTestDb,
} from "./helpers.js";

useTestDb();
const { app, sender, push } = makeAppWithPush();

beforeEach(() => {
  sender.sent.length = 0;
  sender.deadTokens.clear();
  sender.failWith = null;
});

const ANDROID = { token: "fcm-token-phone-1", platform: "android" as const, appVersion: "0.1.0" };

async function signedIn(role: Role) {
  const user = await createUser({ role });
  const auth = bearer((await login(app, user.email as string)).accessToken);
  return { user, auth };
}

async function seedReport() {
  const citizen = await signedIn(Role.CITIZEN);
  const admin = await signedIn(Role.ADMIN);
  const category = await createCategory(`Dumping ${Date.now()}-${Math.random()}`, true, Priority.HIGH);
  const created = await postReport(app, citizen.auth, reportFields(category.id));
  expect(created.status).toBe(201);
  return { citizen, admin, report: created.body as ReportDetailDto };
}

describe("device registration (PUT/DELETE /devices)", () => {
  it("requires a signed-in user", async () => {
    const res = await request(app).put("/devices").send(ANDROID);
    expect(res.status).toBe(401);
  });

  it("names the missing or invalid fields", async () => {
    const { auth } = await signedIn(Role.CITIZEN);
    const res = await request(app).put("/devices").set(auth).send({ platform: "windows" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    const fields = (res.body.error.details as { field: string }[]).map((d) => d.field).sort();
    expect(fields).toEqual(["platform", "token"]);
  });

  it("registers a device once, even when the app sends the same token on every start", async () => {
    const { user, auth } = await signedIn(Role.CITIZEN);
    expect((await request(app).put("/devices").set(auth).send(ANDROID)).status).toBe(204);
    expect((await request(app).put("/devices").set(auth).send({ ...ANDROID, appVersion: "0.2.0" })).status).toBe(204);

    const rows = await prisma.pushDevice.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ token: ANDROID.token, platform: "android", appVersion: "0.2.0" });
  });

  it("moves a shared phone to the account that signs in last", async () => {
    const first = await signedIn(Role.CITIZEN);
    const second = await signedIn(Role.FIELD);
    await request(app).put("/devices").set(first.auth).send(ANDROID);
    await request(app).put("/devices").set(second.auth).send(ANDROID);

    const rows = await prisma.pushDevice.findMany({ where: { token: ANDROID.token } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(second.user.id);
  });

  it("removes the device on sign out, but only for its owner", async () => {
    const owner = await signedIn(Role.CITIZEN);
    const other = await signedIn(Role.CITIZEN);
    await request(app).put("/devices").set(owner.auth).send(ANDROID);

    // Someone else cannot unregister a phone that is not theirs.
    expect((await request(app).delete("/devices").set(other.auth).send({ token: ANDROID.token })).status).toBe(204);
    expect(await prisma.pushDevice.count({ where: { token: ANDROID.token } })).toBe(1);

    expect((await request(app).delete("/devices").set(owner.auth).send({ token: ANDROID.token })).status).toBe(204);
    expect(await prisma.pushDevice.count({ where: { token: ANDROID.token } })).toBe(0);
  });
});

describe("push delivery after a notification is written", () => {
  it("sends the citizen the same text as the in-app notification when the status changes", async () => {
    const { citizen, admin, report } = await seedReport();
    await request(app).put("/devices").set(citizen.auth).send(ANDROID);
    await request(app).put("/devices").set(citizen.auth).send({ token: "fcm-token-tablet", platform: "android" });

    const res = await request(app)
      .patch(`/reports/${report.id}/status`)
      .set(admin.auth)
      .send({ status: ReportStatus.VALIDATED, note: "Photo confirms the dump" });
    expect(res.status).toBe(200);
    await push.settle();

    const inApp = await prisma.notification.findFirstOrThrow({ where: { userId: citizen.user.id } });
    expect(sender.sent).toHaveLength(2);
    expect(sender.sent.map((m) => m.token).sort()).toEqual(["fcm-token-phone-1", "fcm-token-tablet"]);
    for (const message of sender.sent) {
      expect(message).toMatchObject({
        title: PUSH_TITLE,
        body: inApp.message,
        data: { reportId: report.id, reference: report.reference },
      });
      expect(message.body).toBe(`${report.reference}: Validated by admin — Photo confirms the dump`);
    }
  });

  it("does not push to people who were not notified", async () => {
    const { citizen, admin, report } = await seedReport();
    await request(app).put("/devices").set(admin.auth).send({ token: "fcm-token-admin", platform: "android" });
    await request(app).put("/devices").set(citizen.auth).send(ANDROID);

    await request(app).patch(`/reports/${report.id}/status`).set(admin.auth).send({ status: ReportStatus.VALIDATED });
    await push.settle();

    expect(sender.sent.map((m) => m.token)).toEqual([ANDROID.token]);
  });

  it("pushes a new task to the field officer and the assignment to the citizen (T06)", async () => {
    const { citizen, admin, report } = await seedReport();
    const field = await signedIn(Role.FIELD);
    await request(app).put("/devices").set(citizen.auth).send(ANDROID);
    await request(app).put("/devices").set(field.auth).send({ token: "fcm-token-officer", platform: "android" });

    await request(app).patch(`/reports/${report.id}/status`).set(admin.auth).send({ status: ReportStatus.VALIDATED });
    await push.settle();
    sender.sent.length = 0;

    const assigned = await request(app).post(`/reports/${report.id}/assign`).set(admin.auth).send({ assigneeId: field.user.id });
    expect(assigned.status).toBe(200);
    await push.settle();

    const byToken = Object.fromEntries(sender.sent.map((m) => [m.token, m.body]));
    expect(byToken["fcm-token-officer"]).toMatch(new RegExp(`^New task ${report.reference}: `));
    expect(byToken[ANDROID.token]).toBe(`${report.reference}: Assigned to field team`);
    expect(sender.sent).toHaveLength(2);
  });

  it("forgets a token Firebase reports as dead, and keeps the others", async () => {
    const { citizen, admin, report } = await seedReport();
    await request(app).put("/devices").set(citizen.auth).send(ANDROID);
    await request(app).put("/devices").set(citizen.auth).send({ token: "fcm-token-old-phone", platform: "android" });
    sender.deadTokens.add("fcm-token-old-phone");

    await request(app).patch(`/reports/${report.id}/status`).set(admin.auth).send({ status: ReportStatus.VALIDATED });
    await push.settle();
    sender.deadTokens.clear();

    const remaining = await prisma.pushDevice.findMany({ where: { userId: citizen.user.id }, select: { token: true } });
    expect(remaining).toEqual([{ token: ANDROID.token }]);
  });

  it("still changes the status and writes the in-app notification when Firebase is down", async () => {
    const { citizen, admin, report } = await seedReport();
    await request(app).put("/devices").set(citizen.auth).send(ANDROID);
    sender.failWith = new Error("FCM unreachable");

    const res = await request(app).patch(`/reports/${report.id}/status`).set(admin.auth).send({ status: ReportStatus.VALIDATED });
    await push.settle();
    sender.failWith = null;

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(ReportStatus.VALIDATED);
    expect(await prisma.notification.count({ where: { userId: citizen.user.id } })).toBe(1);
  });

  it("sends nothing when the user has no registered phone", async () => {
    const { admin, report } = await seedReport();
    await request(app).patch(`/reports/${report.id}/status`).set(admin.auth).send({ status: ReportStatus.VALIDATED });
    await push.settle();
    expect(sender.sent).toHaveLength(0);
  });
});
