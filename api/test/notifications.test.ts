import { Priority, ReportStatus, Role, type NotificationDto, type Paginated, type ReportDetailDto } from "@smart-waste/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { bearer, createCategory, createUser, login, makeApp, postReport, prisma, reportFields, useTestDb } from "./helpers.js";

useTestDb();
const app = makeApp();

let seedCounter = 0;

async function seedReport() {
  seedCounter += 1;
  const citizen = await createUser({ role: Role.CITIZEN });
  const citizenAuth = bearer((await login(app, citizen.email as string)).accessToken);
  const admin = await createUser({ role: Role.ADMIN });
  const adminAuth = bearer((await login(app, admin.email as string)).accessToken);
  const category = await createCategory(`Litter ${seedCounter}-${Date.now()}`, true, Priority.MEDIUM);
  const created = await postReport(app, citizenAuth, reportFields(category.id));
  expect(created.status).toBe(201);
  return { citizen, citizenAuth, admin, adminAuth, report: created.body as ReportDetailDto };
}

describe("report closure notification (T10)", () => {
  it("tells the citizen when the report is resolved and closed, and the status reads CLOSED", async () => {
    const { citizenAuth, adminAuth, report } = await seedReport();
    const field = await createUser({ role: Role.FIELD });
    const fieldAuth = bearer((await login(app, field.email as string)).accessToken);

    // Nothing yet: sending a report does not notify its own author.
    const none = await request(app).get("/notifications/unread-count").set(citizenAuth);
    expect(none.body).toEqual({ unread: 0 });

    await request(app).patch(`/reports/${report.id}/status`).set(adminAuth).send({ status: ReportStatus.VALIDATED });
    await request(app).post(`/reports/${report.id}/assign`).set(adminAuth).send({ assigneeId: field.id });
    await request(app).patch(`/reports/${report.id}/status`).set(fieldAuth).send({ status: ReportStatus.IN_PROGRESS });
    await request(app).patch(`/reports/${report.id}/status`).set(fieldAuth).send({ status: ReportStatus.RESOLVED });

    const closed = await request(app)
      .patch(`/reports/${report.id}/status`)
      .set(adminAuth)
      .send({ status: ReportStatus.CLOSED, note: "Confirmed with the citizen" });
    expect(closed.status).toBe(200);

    const unread = await request(app).get("/notifications/unread-count").set(citizenAuth);
    expect(unread.body).toEqual({ unread: 5 });

    const list = await request(app).get("/notifications").set(citizenAuth);
    expect(list.status).toBe(200);
    const page = list.body as Paginated<NotificationDto>;
    expect(page.total).toBe(5);
    expect(page.items[0]).toMatchObject({
      message: `${report.reference}: Report closed — Confirmed with the citizen`,
      read: false,
      report: { id: report.id, reference: report.reference },
    });
    expect(page.items.map((n) => n.message)).toEqual([
      `${report.reference}: Report closed — Confirmed with the citizen`,
      `${report.reference}: Report resolved`,
      `${report.reference}: Collection in progress`,
      `${report.reference}: Assigned to field team`,
      `${report.reference}: Validated by admin`,
    ]);

    // Opening the report shows the closed status.
    const view = await request(app).get(`/reports/${report.id}`).set(citizenAuth);
    expect(view.body.status).toBe(ReportStatus.CLOSED);
    expect(view.body.closedAt).toBeTruthy();
    expect(view.body.history.at(-1)).toMatchObject({ oldStatus: ReportStatus.RESOLVED, newStatus: ReportStatus.CLOSED });
  });

  it("includes the reason when a report is rejected", async () => {
    const { citizenAuth, adminAuth, report } = await seedReport();
    await request(app)
      .patch(`/reports/${report.id}/status`)
      .set(adminAuth)
      .send({ status: ReportStatus.REJECTED, note: "Duplicate of an earlier report" });

    const list = await request(app).get("/notifications").set(citizenAuth);
    expect(list.body.items.map((n: NotificationDto) => n.message)).toEqual([
      `${report.reference}: Report not accepted — Duplicate of an earlier report`,
    ]);
  });
});

describe("reading notifications", () => {
  it("marks one as read, marks all as read, and filters unread", async () => {
    const { citizenAuth, adminAuth, report } = await seedReport();
    await request(app).patch(`/reports/${report.id}/status`).set(adminAuth).send({ status: ReportStatus.VALIDATED });
    await prisma.wasteReport.update({ where: { id: report.id }, data: { status: ReportStatus.RESOLVED } });
    await request(app).patch(`/reports/${report.id}/status`).set(adminAuth).send({ status: ReportStatus.CLOSED });

    const all = (await request(app).get("/notifications").set(citizenAuth)).body as Paginated<NotificationDto>;
    expect(all.total).toBe(2);
    const newest = all.items[0] as NotificationDto;
    const oldest = all.items[1] as NotificationDto;

    const marked = await request(app).patch(`/notifications/${newest.id}/read`).set(citizenAuth);
    expect(marked.status).toBe(200);
    expect(marked.body).toMatchObject({ id: newest.id, read: true });

    const unreadOnly = await request(app).get("/notifications?unread=true").set(citizenAuth);
    expect(unreadOnly.body.items.map((n: NotificationDto) => n.id)).toEqual([oldest.id]);
    expect((await request(app).get("/notifications/unread-count").set(citizenAuth)).body).toEqual({ unread: 1 });

    const readAll = await request(app).post("/notifications/read-all").set(citizenAuth);
    expect(readAll.status).toBe(200);
    expect(readAll.body).toEqual({ updated: 1 });
    expect((await request(app).get("/notifications/unread-count").set(citizenAuth)).body).toEqual({ unread: 0 });

    // Second pass changes nothing.
    expect((await request(app).post("/notifications/read-all").set(citizenAuth)).body).toEqual({ updated: 0 });
  });

  it("never shows or marks another user's notifications", async () => {
    const { citizenAuth, adminAuth, report } = await seedReport();
    await request(app).patch(`/reports/${report.id}/status`).set(adminAuth).send({ status: ReportStatus.VALIDATED });
    const mine = (await request(app).get("/notifications").set(citizenAuth)).body as Paginated<NotificationDto>;
    const id = mine.items[0]?.id;
    expect(id).toBeTruthy();

    const stranger = await createUser({ role: Role.CITIZEN });
    const strangerAuth = bearer((await login(app, stranger.email as string)).accessToken);
    expect((await request(app).get("/notifications").set(strangerAuth)).body.total).toBe(0);
    const attempt = await request(app).patch(`/notifications/${id}/read`).set(strangerAuth);
    expect(attempt.status).toBe(404);

    // Still unread for the owner.
    expect((await request(app).get("/notifications/unread-count").set(citizenAuth)).body).toEqual({ unread: 1 });

    // No token at all.
    expect((await request(app).get("/notifications")).status).toBe(401);
  });

  it("rejects a malformed id and paginates", async () => {
    const { citizenAuth } = await seedReport();
    const bad = await request(app).patch("/notifications/not-a-uuid/read").set(citizenAuth);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");

    const paged = await request(app).get("/notifications?page=2&pageSize=1").set(citizenAuth);
    expect(paged.status).toBe(200);
    expect(paged.body).toMatchObject({ page: 2, pageSize: 1, total: 0, items: [] });
  });
});
