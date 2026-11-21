import {
  AssignmentStatus,
  Priority,
  ReportStatus,
  Role,
  type NotificationDto,
  type Paginated,
  type ReportDetailDto,
  type TaskDto,
} from "@smart-waste/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { bearer, createCategory, createUser, login, makeApp, postReport, prisma, reportFields, useTestDb } from "./helpers.js";

useTestDb();
const app = makeApp();

let seedCounter = 0;

/** Citizen sends a report; admin validates and assigns it to a field officer. */
async function seedAssignedReport(options: { note?: string } = {}) {
  seedCounter += 1;
  const citizen = await createUser({ role: Role.CITIZEN, name: "Bola Citizen" });
  const citizenAuth = bearer((await login(app, citizen.email as string)).accessToken);
  const admin = await createUser({ role: Role.ADMIN, name: "Ngozi Admin" });
  const adminAuth = bearer((await login(app, admin.email as string)).accessToken);
  const field = await createUser({ role: Role.FIELD, name: "Ada Field" });
  const fieldAuth = bearer((await login(app, field.email as string)).accessToken);
  const category = await createCategory(`Overflowing bin ${seedCounter}-${Date.now()}`, true, Priority.HIGH);

  const created = await postReport(app, citizenAuth, reportFields(category.id));
  expect(created.status).toBe(201);
  const report = created.body as ReportDetailDto;

  await request(app).patch(`/reports/${report.id}/status`).set(adminAuth).send({ status: ReportStatus.VALIDATED });
  const assigned = await request(app)
    .post(`/reports/${report.id}/assign`)
    .set(adminAuth)
    .send({ assigneeId: field.id, note: options.note ?? "Clear before Friday" });
  expect(assigned.status).toBe(200);

  return { citizen, citizenAuth, admin, adminAuth, field, fieldAuth, category, report };
}

describe("GET /tasks/my", () => {
  it("shows the officer their assignment with the full report, most urgent first", async () => {
    const { field, fieldAuth, report, category, admin } = await seedAssignedReport();

    const res = await request(app).get("/tasks/my").set(fieldAuth);
    expect(res.status).toBe(200);
    const page = res.body as Paginated<TaskDto>;
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      assignmentStatus: AssignmentStatus.PENDING,
      acknowledgedAt: null,
      completedAt: null,
      note: "Clear before Friday",
      assignedBy: { id: admin.id, name: "Ngozi Admin" },
      report: {
        id: report.id,
        reference: report.reference,
        status: ReportStatus.ASSIGNED,
        priority: Priority.HIGH,
        category: { id: category.id, name: category.name },
        assignment: { assignee: { id: field.id } },
      },
    });
    // Privacy: the officer does not see who reported it.
    expect(page.items[0]?.report.citizen).toBeUndefined();

    const counts = await request(app).get("/tasks/my/counts").set(fieldAuth);
    expect(counts.body).toEqual({ active: 1, completed: 0 });

    const completed = await request(app).get("/tasks/my?group=completed").set(fieldAuth);
    expect(completed.body.total).toBe(0);
  });

  it("is empty for another officer and forbidden for citizens and admins", async () => {
    await seedAssignedReport();
    const other = await createUser({ role: Role.FIELD });
    const otherAuth = bearer((await login(app, other.email as string)).accessToken);
    const list = await request(app).get("/tasks/my").set(otherAuth);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(0);

    const citizen = await createUser({ role: Role.CITIZEN });
    const citizenAuth = bearer((await login(app, citizen.email as string)).accessToken);
    expect((await request(app).get("/tasks/my").set(citizenAuth)).status).toBe(403);

    const admin = await createUser({ role: Role.ADMIN });
    const adminAuth = bearer((await login(app, admin.email as string)).accessToken);
    expect((await request(app).get("/tasks/my").set(adminAuth)).status).toBe(403);
  });
});

describe("field officer works a task (T07)", () => {
  it("acknowledges, starts, resolves with a note; history and the citizen's view change", async () => {
    const { citizenAuth, fieldAuth, report } = await seedAssignedReport();

    const tasks = await request(app).get("/tasks/my").set(fieldAuth);
    const task = (tasks.body as Paginated<TaskDto>).items[0] as TaskDto;

    // Acknowledge (assignment status, not report status).
    const ack = await request(app).post(`/tasks/${task.assignmentId}/acknowledge`).set(fieldAuth);
    expect(ack.status).toBe(200);
    expect(ack.body).toMatchObject({ assignmentId: task.assignmentId, assignmentStatus: AssignmentStatus.ACKNOWLEDGED });
    expect(ack.body.acknowledgedAt).toBeTruthy();

    // Acknowledging twice is harmless.
    const again = await request(app).post(`/tasks/${task.assignmentId}/acknowledge`).set(fieldAuth);
    expect(again.status).toBe(200);
    expect(again.body.acknowledgedAt).toBe(ack.body.acknowledgedAt);

    const stillAssigned = await request(app).get(`/reports/${report.id}`).set(citizenAuth);
    expect(stillAssigned.body.status).toBe(ReportStatus.ASSIGNED);

    // Start work.
    const started = await request(app)
      .patch(`/reports/${report.id}/status`)
      .set(fieldAuth)
      .send({ status: ReportStatus.IN_PROGRESS });
    expect(started.status).toBe(200);
    expect(started.body.status).toBe(ReportStatus.IN_PROGRESS);

    // A field officer may not skip straight to CLOSED.
    const closeAttempt = await request(app)
      .patch(`/reports/${report.id}/status`)
      .set(fieldAuth)
      .send({ status: ReportStatus.CLOSED });
    expect(closeAttempt.status).toBe(409);
    expect(closeAttempt.body.error.code).toBe("INVALID_TRANSITION");

    // Mark completed with an operational note.
    const resolved = await request(app)
      .patch(`/reports/${report.id}/status`)
      .set(fieldAuth)
      .send({ status: ReportStatus.RESOLVED, note: "Cleared 12 bags, area disinfected" });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe(ReportStatus.RESOLVED);
    expect(resolved.body.resolvedAt).toBeTruthy();

    // History is auditable (FR-10).
    const history = (resolved.body as ReportDetailDto).history.map((h) => [h.oldStatus, h.newStatus]);
    expect(history).toEqual([
      [null, ReportStatus.NEW],
      [ReportStatus.NEW, ReportStatus.VALIDATED],
      [ReportStatus.VALIDATED, ReportStatus.ASSIGNED],
      [ReportStatus.ASSIGNED, ReportStatus.IN_PROGRESS],
      [ReportStatus.IN_PROGRESS, ReportStatus.RESOLVED],
    ]);
    expect((resolved.body as ReportDetailDto).history.at(-1)?.note).toBe("Cleared 12 bags, area disinfected");

    // The assignment is completed and moves to the "completed" list.
    const active = await request(app).get("/tasks/my").set(fieldAuth);
    expect(active.body.total).toBe(0);
    const done = await request(app).get("/tasks/my?group=completed").set(fieldAuth);
    expect(done.body.total).toBe(1);
    expect(done.body.items[0]).toMatchObject({ assignmentStatus: AssignmentStatus.COMPLETED });
    expect(done.body.items[0].completedAt).toBeTruthy();
    const counts = await request(app).get("/tasks/my/counts").set(fieldAuth);
    expect(counts.body).toEqual({ active: 0, completed: 1 });

    // The citizen sees the updated state (T07) ...
    const citizenView = await request(app).get(`/reports/${report.id}`).set(citizenAuth);
    expect(citizenView.status).toBe(200);
    expect(citizenView.body.status).toBe(ReportStatus.RESOLVED);
    expect(citizenView.body.history).toHaveLength(5);

    // ... and was told about each step (FR-08).
    const notifications = await request(app).get("/notifications").set(citizenAuth);
    const messages = (notifications.body as Paginated<NotificationDto>).items.map((n) => n.message);
    expect(messages).toEqual([
      `${report.reference}: Report resolved — Cleared 12 bags, area disinfected`,
      `${report.reference}: Collection in progress`,
      `${report.reference}: Assigned to field team`,
      `${report.reference}: Validated by admin`,
    ]);

    // Acknowledging a completed task is refused.
    const late = await request(app).post(`/tasks/${task.assignmentId}/acknowledge`).set(fieldAuth);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("CONFLICT");
  });

  it("keeps another officer out of a task that is not theirs", async () => {
    const { fieldAuth, report } = await seedAssignedReport();
    const other = await createUser({ role: Role.FIELD });
    const otherAuth = bearer((await login(app, other.email as string)).accessToken);

    const task = (await request(app).get("/tasks/my").set(fieldAuth)).body.items[0] as TaskDto;

    expect((await request(app).get(`/tasks/${task.assignmentId}`).set(otherAuth)).status).toBe(404);
    expect((await request(app).post(`/tasks/${task.assignmentId}/acknowledge`).set(otherAuth)).status).toBe(404);

    const forbidden = await request(app)
      .patch(`/reports/${report.id}/status`)
      .set(otherAuth)
      .send({ status: ReportStatus.IN_PROGRESS });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.message).toBe("This report is not assigned to you");

    // The rightful officer can open the task directly.
    const mine = await request(app).get(`/tasks/${task.assignmentId}`).set(fieldAuth);
    expect(mine.status).toBe(200);
    expect(mine.body.report.id).toBe(report.id);
  });

  it("moves a reassigned task away from the first officer and tells both", async () => {
    const { adminAuth, field, fieldAuth, report } = await seedAssignedReport();
    const second = await createUser({ role: Role.FIELD, name: "Chidi Field" });
    const secondAuth = bearer((await login(app, second.email as string)).accessToken);

    const reassigned = await request(app)
      .post(`/reports/${report.id}/assign`)
      .set(adminAuth)
      .send({ assigneeId: second.id });
    expect(reassigned.status).toBe(200);

    expect((await request(app).get("/tasks/my").set(fieldAuth)).body.total).toBe(0);
    expect((await request(app).get("/tasks/my").set(secondAuth)).body.total).toBe(1);

    const oldTask = await prisma.assignment.findFirst({ where: { reportId: report.id, assigneeId: field.id } });
    expect(oldTask?.status).toBe(AssignmentStatus.REASSIGNED);
    const lateAck = await request(app).post(`/tasks/${oldTask?.id}/acknowledge`).set(fieldAuth);
    expect(lateAck.status).toBe(409);

    const firstMessages = (await request(app).get("/notifications").set(fieldAuth)).body.items.map(
      (n: NotificationDto) => n.message,
    );
    expect(firstMessages).toEqual([
      `${report.reference} was reassigned to another officer`,
      expect.stringMatching(new RegExp(`^New task ${report.reference}: Overflowing bin .* \\(High priority\\)$`)),
    ]);
    const secondMessages = (await request(app).get("/notifications").set(secondAuth)).body.items.map(
      (n: NotificationDto) => n.message,
    );
    expect(secondMessages).toHaveLength(1);
    expect(secondMessages[0]).toMatch(/^New task SW-\d+: Overflowing bin/);
  });
});
