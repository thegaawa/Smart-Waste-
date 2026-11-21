import { Role, UserStatus } from "@smart-waste/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { authHeaderFor, bearer, createUser, DEFAULT_PASSWORD, login, makeApp, prisma, useTestDb } from "./helpers.js";

useTestDb();
const app = makeApp();

describe("role-based access to /admin/users", () => {
  it("T08: a citizen calling an admin endpoint gets 403", async () => {
    const res = await request(app).get("/admin/users").set(await authHeaderFor(app, Role.CITIZEN));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("a field officer calling an admin endpoint gets 403", async () => {
    const res = await request(app).get("/admin/users").set(await authHeaderFor(app, Role.FIELD));
    expect(res.status).toBe(403);
  });

  it("an anonymous caller gets 401, not 403", async () => {
    const res = await request(app).get("/admin/users");
    expect(res.status).toBe(401);
  });

  it("an admin can list users with paging and a role filter", async () => {
    await createUser({ role: Role.FIELD, name: "Field One" });
    await createUser({ role: Role.FIELD, name: "Field Two" });
    await createUser({ role: Role.CITIZEN });
    const admin = await authHeaderFor(app, Role.ADMIN);

    const all = await request(app).get("/admin/users").set(admin);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(4);
    expect(all.body.items).toHaveLength(4);

    const fieldOnly = await request(app).get("/admin/users?role=FIELD&pageSize=1").set(admin);
    expect(fieldOnly.status).toBe(200);
    expect(fieldOnly.body.total).toBe(2);
    expect(fieldOnly.body.items).toHaveLength(1);
    expect(fieldOnly.body.items[0].role).toBe(Role.FIELD);
  });
});

describe("admin user management", () => {
  it("creates a field officer who can sign in but cannot use admin routes", async () => {
    const admin = await authHeaderFor(app, Role.ADMIN);

    const created = await request(app).post("/admin/users").set(admin).send({
      name: "Team A Officer",
      phone: "0803 000 0002",
      password: "Field12345!",
      role: Role.FIELD,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ role: Role.FIELD, phone: "+2348030000002", email: null });

    const auth = await login(app, "08030000002", "Field12345!");
    expect(auth.user.role).toBe(Role.FIELD);

    const forbidden = await request(app).get("/admin/users").set(bearer(auth.accessToken));
    expect(forbidden.status).toBe(403);
  });

  it("rejects an invalid role", async () => {
    const admin = await authHeaderFor(app, Role.ADMIN);
    const res = await request(app)
      .post("/admin/users")
      .set(admin)
      .send({ name: "X Y", email: "x@example.com", password: "Secret1234", role: "SUPERUSER" });

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual(["role"]);
  });

  it("disabling an account ends its sessions and blocks new sign-ins", async () => {
    const admin = await authHeaderFor(app, Role.ADMIN);
    const target = await createUser({ email: "target@example.com" });
    const targetAuth = await login(app, "target@example.com");

    const res = await request(app)
      .patch(`/admin/users/${target.id}`)
      .set(admin)
      .send({ status: UserStatus.DISABLED });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(UserStatus.DISABLED);

    const me = await request(app).get("/auth/me").set(bearer(targetAuth.accessToken));
    expect(me.status).toBe(401);

    const refresh = await request(app).post("/auth/refresh").send({ refreshToken: targetAuth.refreshToken });
    expect(refresh.status).toBe(401);

    const relogin = await request(app)
      .post("/auth/login")
      .send({ identifier: "target@example.com", password: DEFAULT_PASSWORD });
    expect(relogin.status).toBe(403);
  });

  it("an admin cannot disable or demote their own account", async () => {
    const adminUser = await createUser({ role: Role.ADMIN, email: "boss@example.com" });
    const auth = await login(app, "boss@example.com");

    const disable = await request(app)
      .patch(`/admin/users/${adminUser.id}`)
      .set(bearer(auth.accessToken))
      .send({ status: UserStatus.DISABLED });
    expect(disable.status).toBe(409);

    const demote = await request(app)
      .patch(`/admin/users/${adminUser.id}`)
      .set(bearer(auth.accessToken))
      .send({ role: Role.CITIZEN });
    expect(demote.status).toBe(409);

    const stillAdmin = await prisma.user.findUnique({ where: { id: adminUser.id } });
    expect(stillAdmin?.role).toBe(Role.ADMIN);
    expect(stillAdmin?.status).toBe(UserStatus.ACTIVE);
  });

  it("returns 404 for an unknown user id and 400 for a malformed id", async () => {
    const admin = await authHeaderFor(app, Role.ADMIN);

    const missing = await request(app).get("/admin/users/0199e000-0000-7000-8000-000000000000").set(admin);
    expect(missing.status).toBe(404);

    const malformed = await request(app).get("/admin/users/not-a-uuid").set(admin);
    expect(malformed.status).toBe(400);
  });
});
