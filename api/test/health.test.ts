import request from "supertest";
import { describe, expect, it } from "vitest";

import { makeApp, useTestDb } from "./helpers.js";

useTestDb();
const app = makeApp();

describe("GET /health", () => {
  it("reports the service and a live database", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", service: "smart-waste-api", database: "up" });
    expect(typeof res.body.version).toBe("string");
    expect(new Date(res.body.time).toString()).not.toBe("Invalid Date");
  });
});

describe("routing basics", () => {
  it("describes the service at the root", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("smart-waste-api");
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const res = await request(app).get("/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns a JSON 400 for malformed JSON bodies", async () => {
    const res = await request(app)
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("does not reveal the server technology", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
