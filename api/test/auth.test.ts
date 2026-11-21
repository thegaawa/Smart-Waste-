import { Role, UserStatus, type ApiErrorBody, type AuthResponse } from "@smart-waste/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { bearer, createUser, DEFAULT_PASSWORD, login, makeApp, prisma, useTestDb } from "./helpers.js";

useTestDb();
const app = makeApp();

function fieldsOf(body: ApiErrorBody): string[] {
  return (body.error.details ?? []).map((d) => d.field);
}

describe("POST /auth/register", () => {
  it("creates a citizen account with an email and returns tokens", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ name: "Ada Obi", email: "  Ada.Obi@Example.com ", password: "Secret1234" });

    expect(res.status).toBe(201);
    const body = res.body as AuthResponse;
    expect(body.user).toMatchObject({
      name: "Ada Obi",
      email: "ada.obi@example.com",
      phone: null,
      role: Role.CITIZEN,
      status: UserStatus.ACTIVE,
    });
    expect(body.accessToken.split(".")).toHaveLength(3);
    expect(body.refreshToken.length).toBeGreaterThan(40);
    expect(body.accessTokenExpiresIn).toBe(3600);

    const stored = await prisma.user.findUnique({ where: { email: "ada.obi@example.com" } });
    expect(stored?.passwordHash).not.toContain("Secret1234");
  });

  it("creates an account with a local Nigerian phone number, stored in E.164", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ name: "Emeka Nwosu", phone: "0803 123 4567", password: "Secret1234" });

    expect(res.status).toBe(201);
    expect(res.body.user.phone).toBe("+2348031234567");
    expect(res.body.user.email).toBeNull();
  });

  it("always creates a CITIZEN even if the client sends a role", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ name: "Sneaky", email: "sneaky@example.com", password: "Secret1234", role: "ADMIN" });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe(Role.CITIZEN);
  });

  it("rejects a duplicate email with 409", async () => {
    await createUser({ email: "taken@example.com" });
    const res = await request(app)
      .post("/auth/register")
      .send({ name: "Second", email: "TAKEN@example.com", password: "Secret1234" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("rejects a duplicate phone with 409", async () => {
    await createUser({ email: null, phone: "+2348031234567" });
    const res = await request(app)
      .post("/auth/register")
      .send({ name: "Second", phone: "08031234567", password: "Secret1234" });

    expect(res.status).toBe(409);
  });

  it("names the missing field when the password is absent (T04 pattern)", async () => {
    const res = await request(app).post("/auth/register").send({ name: "Ada", email: "ada@example.com" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details).toEqual([{ field: "password", message: "Password is required" }]);
  });

  it("requires an email or a phone number", async () => {
    const res = await request(app).post("/auth/register").send({ name: "Ada", password: "Secret1234" });

    expect(res.status).toBe(400);
    expect(fieldsOf(res.body)).toContain("email");
  });

  it("rejects short passwords and invalid phone numbers", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ name: "Ada", phone: "12345", password: "short" });

    expect(res.status).toBe(400);
    expect(fieldsOf(res.body).sort()).toEqual(["password", "phone"]);
  });
});

describe("POST /auth/login", () => {
  it("T01: signs in a citizen with a valid email and password", async () => {
    const user = await createUser({ email: "citizen@example.com" });
    const res = await request(app)
      .post("/auth/login")
      .send({ identifier: "Citizen@Example.com", password: DEFAULT_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.user.role).toBe(Role.CITIZEN);
    expect(res.body.accessToken).toBeTruthy();
  });

  it("T02: rejects a wrong password with a clear message and no tokens", async () => {
    await createUser({ email: "citizen@example.com" });
    const res = await request(app)
      .post("/auth/login")
      .send({ identifier: "citizen@example.com", password: "not-the-password" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(res.body.error.message).toBe("The email/phone or password is incorrect");
    expect(res.body.accessToken).toBeUndefined();
  });

  it("rejects an unknown account with the same message", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ identifier: "nobody@example.com", password: DEFAULT_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("The email/phone or password is incorrect");
  });

  it("signs in with a phone number typed in local format", async () => {
    await createUser({ email: null, phone: "+2348031234567" });
    const res = await request(app)
      .post("/auth/login")
      .send({ identifier: "0803-123-4567", password: DEFAULT_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.phone).toBe("+2348031234567");
  });

  it("names missing fields", async () => {
    const res = await request(app).post("/auth/login").send({});

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { field: "identifier", message: "Email or phone is required" },
      { field: "password", message: "Password is required" },
    ]);
  });

  it("refuses a disabled account with 403", async () => {
    await createUser({ email: "off@example.com", status: UserStatus.DISABLED });
    const res = await request(app)
      .post("/auth/login")
      .send({ identifier: "off@example.com", password: DEFAULT_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

describe("GET /auth/me", () => {
  it("returns the signed-in user's profile", async () => {
    const user = await createUser({ email: "me@example.com", name: "Me Myself" });
    const auth = await login(app, "me@example.com");

    const res = await request(app).get("/auth/me").set(bearer(auth.accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: user.id, name: "Me Myself", email: "me@example.com" });
  });

  it("rejects requests without a token", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a tampered token", async () => {
    await createUser({ email: "me@example.com" });
    const auth = await login(app, "me@example.com");
    const tampered = `${auth.accessToken.slice(0, -4)}abcd`;

    const res = await request(app).get("/auth/me").set(bearer(tampered));
    expect(res.status).toBe(401);
  });

  it("rejects a token whose account was disabled afterwards", async () => {
    const user = await createUser({ email: "me@example.com" });
    const auth = await login(app, "me@example.com");
    await prisma.user.update({ where: { id: user.id }, data: { status: UserStatus.DISABLED } });

    const res = await request(app).get("/auth/me").set(bearer(auth.accessToken));
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/refresh and /auth/logout", () => {
  it("rotates the refresh token: the new one works, the old one is revoked", async () => {
    await createUser({ email: "me@example.com" });
    const first = await login(app, "me@example.com");

    const refreshed = await request(app).post("/auth/refresh").send({ refreshToken: first.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(first.refreshToken);
    expect(refreshed.body.accessToken).toBeTruthy();

    const reuseOld = await request(app).post("/auth/refresh").send({ refreshToken: first.refreshToken });
    expect(reuseOld.status).toBe(401);

    const me = await request(app).get("/auth/me").set(bearer(refreshed.body.accessToken));
    expect(me.status).toBe(200);
  });

  it("rejects an unknown refresh token", async () => {
    const res = await request(app).post("/auth/refresh").send({ refreshToken: "x".repeat(64) });
    expect(res.status).toBe(401);
  });

  it("logout revokes the refresh token and is safe to repeat", async () => {
    await createUser({ email: "me@example.com" });
    const auth = await login(app, "me@example.com");

    const first = await request(app).post("/auth/logout").send({ refreshToken: auth.refreshToken });
    expect(first.status).toBe(204);

    const second = await request(app).post("/auth/logout").send({ refreshToken: auth.refreshToken });
    expect(second.status).toBe(204);

    const refresh = await request(app).post("/auth/refresh").send({ refreshToken: auth.refreshToken });
    expect(refresh.status).toBe(401);
  });
});
