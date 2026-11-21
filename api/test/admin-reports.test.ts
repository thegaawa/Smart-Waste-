import {
  Priority,
  ReportStatus,
  Role,
  type AdminStatsDto,
  type ApiErrorBody,
  type CategoryDto,
  type Paginated,
  type ReportDetailDto,
  type ReportSummaryDto,
} from "@smart-waste/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  bearer,
  createCategory,
  createUser,
  login,
  makeApp,
  postReport,
  prisma,
  reportFields,
  useTestDb,
} from "./helpers.js";

useTestDb();
const app = makeApp();

function fieldMessages(body: ApiErrorBody): Record<string, string> {
  return Object.fromEntries((body.error.details ?? []).map((d) => [d.field, d.message]));
}

let seedCounter = 0;

async function seedReport() {
  seedCounter += 1;
  const citizen = await createUser({ role: Role.CITIZEN });
  const citizenAuth = bearer((await login(app, citizen.email as string)).accessToken);
  const category = await createCategory(`Dumping ${seedCounter}-${Date.now()}`, true, Priority.HIGH);
  const created = await postReport(app, citizenAuth, reportFields(category.id));
  expect(created.status).toBe(201);
  return { citizen, category, report: created.body as ReportDetailDto };
}

async function adminAuth() {
  const admin = await createUser({ role: Role.ADMIN });
  return { admin, auth: bearer((await login(app, admin.email as string)).accessToken) };
}

describe("GET /admin/reports", () => {
  it("lists every report for an administrator, with filters", async () => {
    const { auth } = await adminAuth();
    const a = await seedReport();
    const b = await seedReport();
    await prisma.wasteReport.update({ where: { id: b.report.id }, data: { status: ReportStatus.VALIDATED } });

    const all = await request(app).get("/admin/reports").set(auth);
    expect(all.status).toBe(200);
    const page = all.body as Paginated<ReportSummaryDto>;
    expect(page.total).toBe(2);
    expect(page.items[0]).toMatchObject({ assignee: null, photoCount: 0 });

    const filtered = await request(app).get("/admin/reports?status=VALIDATED").set(auth);
    expect(filtered.body.items.map((r: ReportSummaryDto) => r.id)).toEqual([b.report.id]);

    const search = await request(app).get("/admin/reports?q=Ikeja").set(auth);
    expect(search.body.total).toBe(2);
    expect(search.body.items.every((r: ReportSummaryDto) => r.address?.includes("Ikeja"))).toBe(true);

    // Unused variable silence for a
    expect(a.report.reference).toMatch(/^SW-/);
  });

  it("refuses a citizen (T08 pattern for admin report queue)", async () => {
    const citizen = await createUser({ role: Role.CITIZEN });
    const auth = bearer((await login(app, citizen.email as string)).accessToken);
    const res = await request(app).get("/admin/reports").set(auth);
    expect(res.status).toBe(403);
  });
});

describe("admin status, priority and assign (T06)", () => {
  it("validates, sets priority, assigns to a field officer, and the officer can open it", async () => {
    const { auth: admin } = await adminAuth();
    const { report } = await seedReport();
    const field = await createUser({ role: Role.FIELD, name: "Ada Field" });
    const fieldAuth = bearer((await login(app, field.email as string)).accessToken);

    const before = await request(app).get(`/reports/${report.id}`).set(fieldAuth);
    expect(before.status).toBe(404);

    const validated = await request(app)
      .patch(`/reports/${report.id}/status`)
      .set(admin)
      .send({ status: ReportStatus.VALIDATED });
    expect(validated.status).toBe(200);
    expect(validated.body).toMatchObject({ status: ReportStatus.VALIDATED });
    expect(validated.body.validatedAt).toBeTruthy();
    expect(validated.body.history.at(-1)).toMatchObject({
      oldStatus: ReportStatus.NEW,
      newStatus: ReportStatus.VALIDATED,
    });

    const priority = await request(app)
      .patch(`/reports/${report.id}/priority`)
      .set(admin)
      .send({ priority: Priority.LOW });
    expect(priority.status).toBe(200);
    expect(priority.body.priority).toBe(Priority.LOW);

    const assigned = await request(app)
      .post(`/reports/${report.id}/assign`)
      .set(admin)
      .send({ assigneeId: field.id, note: "Clear before Friday" });
    expect(assigned.status).toBe(200);
    expect(assigned.body).toMatchObject({
      status: ReportStatus.ASSIGNED,
      assignment: {
        status: "PENDING",
        assignee: { id: field.id, name: "Ada Field" },
        note: "Clear before Friday",
      },
      assignee: { id: field.id, name: "Ada Field" },
    });

    const after = await request(app).get(`/reports/${report.id}`).set(fieldAuth);
    expect(after.status).toBe(200);
    expect(after.body.citizen).toBeUndefined();
    expect(after.body.assignment.assignee.id).toBe(field.id);

    const queue = await request(app).get(`/admin/reports?assigneeId=${field.id}`).set(admin);
    expect(queue.body.items.map((r: ReportSummaryDto) => r.id)).toEqual([report.id]);
    expect(queue.body.items[0].assignee).toEqual({ id: field.id, name: "Ada Field" });
  });

  it("refuses assign before validation, and refuses a non-field assignee", async () => {
    const { auth: admin } = await adminAuth();
    const { report } = await seedReport();
    const citizen = await createUser({ role: Role.CITIZEN });
    const field = await createUser({ role: Role.FIELD });

    const tooEarly = await request(app)
      .post(`/reports/${report.id}/assign`)
      .set(admin)
      .send({ assigneeId: field.id });
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.error.code).toBe("INVALID_TRANSITION");
    expect(tooEarly.body.error.message).toMatch(/Validate/);

    await request(app).patch(`/reports/${report.id}/status`).set(admin).send({ status: ReportStatus.VALIDATED });

    const badAssignee = await request(app)
      .post(`/reports/${report.id}/assign`)
      .set(admin)
      .send({ assigneeId: citizen.id });
    expect(badAssignee.status).toBe(400);
    expect(fieldMessages(badAssignee.body)).toEqual({ assigneeId: "Choose an active field officer" });
  });

  it("rejects a report only with a reason, and reassigns an active assignment", async () => {
    const { auth: admin } = await adminAuth();
    const { report } = await seedReport();
    const fieldA = await createUser({ role: Role.FIELD, name: "Officer A" });
    const fieldB = await createUser({ role: Role.FIELD, name: "Officer B" });

    const noReason = await request(app)
      .patch(`/reports/${report.id}/status`)
      .set(admin)
      .send({ status: ReportStatus.REJECTED });
    expect(noReason.status).toBe(400);
    expect(fieldMessages(noReason.body).note).toMatch(/reason/);

    await request(app).patch(`/reports/${report.id}/status`).set(admin).send({ status: ReportStatus.VALIDATED });
    await request(app).post(`/reports/${report.id}/assign`).set(admin).send({ assigneeId: fieldA.id });

    const reassigned = await request(app)
      .post(`/reports/${report.id}/assign`)
      .set(admin)
      .send({ assigneeId: fieldB.id, note: "Covering Ikeja today" });
    expect(reassigned.status).toBe(200);
    expect(reassigned.body.assignment.assignee.id).toBe(fieldB.id);

    const old = await prisma.assignment.findFirst({ where: { reportId: report.id, assigneeId: fieldA.id } });
    expect(old?.status).toBe("REASSIGNED");
  });

  it("closes a resolved report and refuses an illegal jump", async () => {
    const { auth: admin } = await adminAuth();
    const { report } = await seedReport();

    const jump = await request(app)
      .patch(`/reports/${report.id}/status`)
      .set(admin)
      .send({ status: ReportStatus.CLOSED });
    expect(jump.status).toBe(409);
    expect(jump.body.error.code).toBe("INVALID_TRANSITION");

    await request(app).patch(`/reports/${report.id}/status`).set(admin).send({ status: ReportStatus.VALIDATED });
    // Force through intermediate states for close path.
    await prisma.wasteReport.update({ where: { id: report.id }, data: { status: ReportStatus.RESOLVED } });

    const closed = await request(app)
      .patch(`/reports/${report.id}/status`)
      .set(admin)
      .send({ status: ReportStatus.CLOSED });
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ status: ReportStatus.CLOSED });
    expect(closed.body.closedAt).toBeTruthy();
  });
});

describe("GET /admin/stats", () => {
  it("returns counts by status and ageing open reports", async () => {
    const { auth } = await adminAuth();
    const a = await seedReport();
    const b = await seedReport();
    await prisma.wasteReport.update({ where: { id: a.report.id }, data: { status: ReportStatus.RESOLVED } });
    await prisma.wasteReport.update({
      where: { id: b.report.id },
      data: { createdAt: new Date(Date.now() - 80 * 60 * 60 * 1000) },
    });

    const res = await request(app).get("/admin/stats").set(auth);
    expect(res.status).toBe(200);
    const stats = res.body as AdminStatsDto;
    expect(stats.total).toBe(2);
    expect(stats.byStatus.NEW).toBe(1);
    expect(stats.byStatus.RESOLVED).toBe(1);
    expect(stats.ageingOpen).toBe(1);
  });
});

describe("admin review warnings", () => {
  it("points out a nearby open report and a citizen with several rejected reports", async () => {
    const { auth } = await adminAuth();
    const citizen = await createUser({ role: Role.CITIZEN });
    const citizenAuth = bearer((await login(app, citizen.email as string)).accessToken);
    const category = await createCategory(`Near ${Date.now()}`, true, Priority.HIGH);

    for (let i = 0; i < 3; i += 1) {
      const rejected = await postReport(
        app,
        citizenAuth,
        reportFields(category.id, {
          latitude: 6.45,
          longitude: 3.2,
          description: `Older problem number ${i} by the canal side`,
        }),
      );
      expect(rejected.status).toBe(201);
      await prisma.wasteReport.update({
        where: { id: (rejected.body as ReportDetailDto).id },
        data: { status: ReportStatus.REJECTED },
      });
    }

    const current = await postReport(
      app,
      citizenAuth,
      reportFields(category.id, {
        description: "Fresh heap beside the bus stop today",
      }),
    );
    expect(current.status).toBe(201);
    const currentReport = current.body as ReportDetailDto;

    const other = await createUser({ role: Role.CITIZEN });
    const otherAuth = bearer((await login(app, other.email as string)).accessToken);
    const nearby = await postReport(
      app,
      otherAuth,
      reportFields(category.id, {
        latitude: 6.6022,
        longitude: 3.3515,
        description: "Another heap a short walk from the first",
      }),
    );
    expect(nearby.status).toBe(201);
    const far = await postReport(
      app,
      otherAuth,
      reportFields(category.id, {
        latitude: 6.7018,
        longitude: 3.3515,
        description: "A heap much further north of Ikeja",
      }),
    );
    expect(far.status).toBe(201);

    const detail = await request(app).get(`/admin/reports/${currentReport.id}`).set(auth);
    expect(detail.status).toBe(200);
    expect(detail.body.review.rejectedReportCount).toBe(3);
    expect(detail.body.review.nearbyOpenReports.map((item: { id: string }) => item.id)).toEqual([
      (nearby.body as ReportDetailDto).id,
    ]);
    expect(detail.body.review.nearbyOpenReports[0].distanceMetres).toBeGreaterThan(20);
    expect(detail.body.review.nearbyOpenReports[0].distanceMetres).toBeLessThan(100);

    const ownView = await request(app).get(`/reports/${currentReport.id}`).set(citizenAuth);
    expect(ownView.status).toBe(200);
    expect(ownView.body.review).toBeUndefined();
  });
});

describe("admin categories", () => {
  it("lists every category and creates / updates them", async () => {
    const { auth } = await adminAuth();
    await createCategory("Active one", true);
    await createCategory("Retired one", false);

    const list = await request(app).get("/admin/categories").set(auth);
    expect(list.status).toBe(200);
    expect((list.body as CategoryDto[]).map((c) => c.name).sort()).toEqual(["Active one", "Retired one"]);

    const created = await request(app)
      .post("/admin/categories")
      .set(auth)
      .send({ name: "Blocked drain", defaultPriority: Priority.HIGH, description: "Waterways" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Blocked drain",
      defaultPriority: Priority.HIGH,
      active: true,
    });

    const patched = await request(app)
      .patch(`/admin/categories/${created.body.id}`)
      .set(auth)
      .send({ active: false });
    expect(patched.status).toBe(200);
    expect(patched.body.active).toBe(false);

    const publicList = await request(app)
      .get("/categories")
      .set(bearer((await login(app, (await createUser()).email as string)).accessToken));
    expect(publicList.body.map((c: CategoryDto) => c.name)).toEqual(["Active one"]);
  });
});
