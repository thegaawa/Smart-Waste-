import { randomUUID } from "node:crypto";

import {
  MAX_PHOTO_BYTES,
  Priority,
  ReportStatus,
  Role,
  type ApiErrorBody,
  type Paginated,
  type ReportCountsDto,
  type ReportDetailDto,
  type ReportSummaryDto,
} from "@smart-waste/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  JPEG_BYTES,
  PNG_BYTES,
  bearer,
  createCategory,
  createUser,
  login,
  makeApp,
  makeStorage,
  postReport,
  prisma,
  reportFields,
  useTestDb,
} from "./helpers.js";

useTestDb();
const storage = makeStorage();
const app = makeApp(storage);

async function citizen() {
  const user = await createUser({ role: Role.CITIZEN });
  const auth = await login(app, user.email as string);
  return { user, auth: bearer(auth.accessToken) };
}

function fieldMessages(body: ApiErrorBody): Record<string, string> {
  return Object.fromEntries((body.error.details ?? []).map((d) => [d.field, d.message]));
}

describe("POST /reports", () => {
  it("T03: stores a complete report with photos and returns its reference and status", async () => {
    const { user, auth } = await citizen();
    const category = await createCategory("Illegal dumping", true, Priority.HIGH);

    const res = await postReport(app, auth, reportFields(category.id), [
      { data: JPEG_BYTES, filename: "front.jpg", contentType: "image/jpeg" },
      { data: PNG_BYTES, filename: "side.png", contentType: "image/png" },
    ]);

    expect(res.status).toBe(201);
    expect(res.headers["idempotent-replayed"]).toBeUndefined();
    const report = res.body as ReportDetailDto;
    expect(report).toMatchObject({
      reference: "SW-1000",
      status: ReportStatus.NEW,
      priority: Priority.HIGH, // taken from the category
      category: { id: category.id, name: "Illegal dumping" },
      description: "Refuse heap blocking the drainage beside the bus stop",
      latitude: 6.6018,
      longitude: 3.3515,
      address: "Obafemi Awolowo Way, Ikeja",
      photoCount: 2,
      assignment: null,
      validatedAt: null,
    });
    expect(report.citizen).toBeUndefined(); // citizens do not get their own contact block back
    expect(report.media).toHaveLength(2);
    expect(report.media[0]?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/media\/[0-9a-f-]{36}\?exp=\d+&sig=[A-Za-z0-9_-]+$/);
    expect(report.history).toHaveLength(1);
    expect(report.history[0]).toMatchObject({
      oldStatus: null,
      newStatus: ReportStatus.NEW,
      changedBy: { id: user.id, role: Role.CITIZEN },
    });

    // Database rows and stored files line up with the response.
    const rows = await prisma.reportMedia.findMany({ where: { reportId: report.id }, orderBy: { uploadedAt: "asc" } });
    expect(rows.map((r) => r.mimeType)).toEqual(["image/jpeg", "image/png"]);
    expect(rows.map((r) => r.sizeBytes)).toEqual([JPEG_BYTES.length, PNG_BYTES.length]);
    for (const row of rows) {
      expect(row.storageKey).toMatch(/^photos\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png)$/);
      expect(await storage.open(row.storageKey)).not.toBeNull();
    }
    expect(await prisma.wasteReport.count()).toBe(1);
  });

  it("numbers reports in order: SW-1000, SW-1001, …", async () => {
    const { auth } = await citizen();
    const category = await createCategory("Overflowing bin");

    const first = await postReport(app, auth, reportFields(category.id));
    const second = await postReport(app, auth, reportFields(category.id, { description: "Second bin, same street" }));

    expect(first.body.reference).toBe("SW-1000");
    expect(second.body.reference).toBe("SW-1001");
  });

  it("accepts a JSON body without a photo (the photograph is optional, FR-02)", async () => {
    const { auth } = await citizen();
    const category = await createCategory("Missed collection");

    const res = await postReport(app, auth, reportFields(category.id, { address: undefined }));

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ photoCount: 0, media: [], address: null, priority: Priority.MEDIUM });
  });

  it("T04: rejects a report with no category and names the field", async () => {
    const { auth } = await citizen();

    const res = await request(app)
      .post("/reports")
      .set(auth)
      .send({ description: "Heap of refuse by the road", latitude: 6.5, longitude: 3.4 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(fieldMessages(res.body)).toEqual({ categoryId: "Category is required" });
  });

  it("T04: names every missing or invalid field in one response", async () => {
    const { auth } = await citizen();
    const category = await createCategory("Illegal dumping");

    const res = await postReport(app, auth, {
      categoryId: category.id,
      description: "Bad",
      latitude: "north",
      longitude: 200,
    }, [{ data: JPEG_BYTES }]);

    expect(res.status).toBe(400);
    expect(fieldMessages(res.body)).toEqual({
      description: "Describe the problem in at least 5 characters",
      latitude: "Latitude must be a number",
      longitude: "Longitude must be between -180 and 180",
    });
    expect(await prisma.wasteReport.count()).toBe(0);
  });

  it("rejects an unknown or retired category", async () => {
    const { auth } = await citizen();
    const retired = await createCategory("Old category", false);

    const unknown = await postReport(app, auth, reportFields(randomUUID()));
    const inactive = await postReport(app, auth, reportFields(retired.id));

    expect(unknown.status).toBe(400);
    expect(fieldMessages(unknown.body).categoryId).toMatch(/not available/);
    expect(inactive.status).toBe(400);
    expect(fieldMessages(inactive.body).categoryId).toMatch(/not available/);
  });

  it("rejects a file that is not really an image, whatever its name says", async () => {
    const { auth } = await citizen();
    const category = await createCategory("Illegal dumping");

    const res = await postReport(app, auth, reportFields(category.id), [
      { data: JPEG_BYTES, filename: "ok.jpg" },
      { data: Buffer.from("<script>alert(1)</script>"), filename: "evil.jpg", contentType: "image/jpeg" },
    ]);

    expect(res.status).toBe(400);
    expect(fieldMessages(res.body)).toEqual({ photos: "Photo 2 is not a JPEG, PNG or WebP image" });
    expect(await prisma.wasteReport.count()).toBe(0);
    expect(await prisma.reportMedia.count()).toBe(0);
  });

  it("rejects more than three photos", async () => {
    const { auth } = await citizen();
    const category = await createCategory("Illegal dumping");

    const res = await postReport(app, auth, reportFields(category.id), [
      { data: JPEG_BYTES },
      { data: JPEG_BYTES },
      { data: JPEG_BYTES },
      { data: JPEG_BYTES },
    ]);

    expect(res.status).toBe(400);
    expect(fieldMessages(res.body).photos).toMatch(/up to 3 photos/);
  });

  it("rejects a photo above the size limit with a plain message", async () => {
    const { auth } = await citizen();
    const category = await createCategory("Illegal dumping");
    const huge = Buffer.concat([JPEG_BYTES, Buffer.alloc(MAX_PHOTO_BYTES, 0x33)]);

    const res = await postReport(app, auth, reportFields(category.id), [{ data: huge, filename: "huge.jpg" }]);

    expect(res.status).toBe(400);
    expect(fieldMessages(res.body).photos).toBe("Each photo must be smaller than 5 MB");
  });

  it("requires a signed-in user", async () => {
    const category = await createCategory("Illegal dumping");
    const res = await request(app).post("/reports").send(reportFields(category.id));
    expect(res.status).toBe(401);
  });

  describe("idempotency (a retried submission never creates a duplicate)", () => {
    it("returns the original report for a repeated key and stores nothing new", async () => {
      const { auth } = await citizen();
      const category = await createCategory("Illegal dumping");
      const idempotencyKey = randomUUID();

      const first = await postReport(app, auth, reportFields(category.id, { idempotencyKey }), [{ data: JPEG_BYTES }]);
      const retry = await postReport(app, auth, reportFields(category.id, { idempotencyKey }), [{ data: JPEG_BYTES }]);

      expect(first.status).toBe(201);
      expect(retry.status).toBe(201);
      expect(retry.headers["idempotent-replayed"]).toBe("true");
      expect(retry.body.id).toBe(first.body.id);
      expect(retry.body.reference).toBe("SW-1000");
      expect(await prisma.wasteReport.count()).toBe(1);
      expect(await prisma.reportMedia.count()).toBe(1);

      // The reference sequence was not consumed by the replay.
      const next = await postReport(app, auth, reportFields(category.id, { idempotencyKey: randomUUID() }));
      expect(next.body.reference).toBe("SW-1001");
    });

    it("keys are per user: two citizens may use the same key", async () => {
      const a = await citizen();
      const b = await citizen();
      const category = await createCategory("Illegal dumping");
      const idempotencyKey = randomUUID();

      const first = await postReport(app, a.auth, reportFields(category.id, { idempotencyKey }));
      const second = await postReport(app, b.auth, reportFields(category.id, { idempotencyKey }));

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).not.toBe(first.body.id);
      expect(await prisma.wasteReport.count()).toBe(2);
    });

    it("rejects a malformed key", async () => {
      const { auth } = await citizen();
      const category = await createCategory("Illegal dumping");

      const res = await postReport(app, auth, reportFields(category.id, { idempotencyKey: "not-a-uuid" }));

      expect(res.status).toBe(400);
      expect(fieldMessages(res.body)).toEqual({ idempotencyKey: "Idempotency key must be a UUID" });
    });
  });
});

describe("GET /reports/my", () => {
  it("lists only the caller's reports, newest first, with paging", async () => {
    const a = await citizen();
    const b = await citizen();
    const category = await createCategory("Illegal dumping");

    for (const description of ["First report here", "Second report here", "Third report here"]) {
      expect((await postReport(app, a.auth, reportFields(category.id, { description }))).status).toBe(201);
    }
    expect((await postReport(app, b.auth, reportFields(category.id))).status).toBe(201);

    const res = await request(app).get("/reports/my").set(a.auth);
    expect(res.status).toBe(200);
    const page = res.body as Paginated<ReportSummaryDto>;
    expect(page.total).toBe(3);
    expect(page.items.map((r) => r.reference)).toEqual(["SW-1002", "SW-1001", "SW-1000"]);
    expect(page.items[0]).toMatchObject({
      status: ReportStatus.NEW,
      category: { name: "Illegal dumping" },
      photoCount: 0,
      address: "Obafemi Awolowo Way, Ikeja",
    });
    expect(page.items[0]).not.toHaveProperty("description");

    const second = await request(app).get("/reports/my?page=2&pageSize=2").set(a.auth);
    expect(second.body.items.map((r: ReportSummaryDto) => r.reference)).toEqual(["SW-1000"]);
    expect(second.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
  });

  it("filters by status and by the open / resolved groups", async () => {
    const { auth } = await citizen();
    const category = await createCategory("Illegal dumping");

    const open = await postReport(app, auth, reportFields(category.id));
    const done = await postReport(app, auth, reportFields(category.id, { description: "Already cleared" }));
    await prisma.wasteReport.update({ where: { id: done.body.id }, data: { status: ReportStatus.RESOLVED } });

    const openRes = await request(app).get("/reports/my?group=open").set(auth);
    const resolvedRes = await request(app).get("/reports/my?group=resolved").set(auth);
    const newRes = await request(app).get("/reports/my?status=NEW").set(auth);

    expect(openRes.body.items.map((r: ReportSummaryDto) => r.id)).toEqual([open.body.id]);
    expect(resolvedRes.body.items.map((r: ReportSummaryDto) => r.id)).toEqual([done.body.id]);
    expect(newRes.body.items.map((r: ReportSummaryDto) => r.id)).toEqual([open.body.id]);
  });

  it("rejects bad query parameters", async () => {
    const { auth } = await citizen();
    const res = await request(app).get("/reports/my?pageSize=500&status=DONE").set(auth);
    expect(res.status).toBe(400);
    expect(Object.keys(fieldMessages(res.body)).sort()).toEqual(["pageSize", "status"]);
  });
});

describe("GET /reports/my/counts", () => {
  it("returns open and resolved totals for the home screen", async () => {
    const { auth } = await citizen();
    const category = await createCategory("Illegal dumping");

    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      ids.push((await postReport(app, auth, reportFields(category.id))).body.id as string);
    }
    await prisma.wasteReport.update({ where: { id: ids[0] as string }, data: { status: ReportStatus.RESOLVED } });
    await prisma.wasteReport.update({ where: { id: ids[1] as string }, data: { status: ReportStatus.CLOSED } });
    await prisma.wasteReport.update({ where: { id: ids[2] as string }, data: { status: ReportStatus.REJECTED } });

    const res = await request(app).get("/reports/my/counts").set(auth);
    expect(res.status).toBe(200);
    expect(res.body as ReportCountsDto).toEqual({ open: 1, resolved: 2 });
  });
});

describe("GET /reports/:id", () => {
  it("the citizen who sent it sees the full report, without their own contact block", async () => {
    const { auth } = await citizen();
    const category = await createCategory("Illegal dumping");
    const created = await postReport(app, auth, reportFields(category.id), [{ data: JPEG_BYTES }]);

    const res = await request(app).get(`/reports/${created.body.id}`).set(auth);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: created.body.id, reference: "SW-1000", description: created.body.description });
    expect(res.body.media).toHaveLength(1);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.citizen).toBeUndefined();
  });

  it("another citizen gets 404, so ids reveal nothing", async () => {
    const owner = await citizen();
    const other = await citizen();
    const category = await createCategory("Illegal dumping");
    const created = await postReport(app, owner.auth, reportFields(category.id));

    const res = await request(app).get(`/reports/${created.body.id}`).set(other.auth);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("an administrator sees the report and who reported it", async () => {
    const { user, auth } = await citizen();
    const admin = await createUser({ role: Role.ADMIN });
    const adminAuth = bearer((await login(app, admin.email as string)).accessToken);
    const category = await createCategory("Illegal dumping");
    const created = await postReport(app, auth, reportFields(category.id));

    const res = await request(app).get(`/reports/${created.body.id}`).set(adminAuth);

    expect(res.status).toBe(200);
    expect(res.body.citizen).toEqual({ id: user.id, name: user.name, email: user.email, phone: null });
  });

  it("a field officer sees a report only once it is assigned to them, and never the citizen's contacts", async () => {
    const { auth } = await citizen();
    const admin = await createUser({ role: Role.ADMIN });
    const field = await createUser({ role: Role.FIELD });
    const fieldAuth = bearer((await login(app, field.email as string)).accessToken);
    const category = await createCategory("Illegal dumping");
    const created = await postReport(app, auth, reportFields(category.id));

    const before = await request(app).get(`/reports/${created.body.id}`).set(fieldAuth);
    expect(before.status).toBe(404);

    await prisma.assignment.create({
      data: { reportId: created.body.id, assigneeId: field.id, assignedById: admin.id, note: "Clear before Friday" },
    });

    const after = await request(app).get(`/reports/${created.body.id}`).set(fieldAuth);
    expect(after.status).toBe(200);
    expect(after.body.citizen).toBeUndefined();
    expect(after.body.assignment).toMatchObject({
      status: "PENDING",
      assignee: { id: field.id },
      assignedBy: { id: admin.id },
      note: "Clear before Friday",
    });
  });

  it("rejects an id that is not a UUID", async () => {
    const { auth } = await citizen();
    const res = await request(app).get("/reports/SW-1000").set(auth);
    expect(res.status).toBe(400);
    expect(fieldMessages(res.body)).toEqual({ id: "Invalid report id" });
  });
});
