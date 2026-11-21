import { Role } from "@smart-waste/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { authHeaderFor, createCategory, makeApp, useTestDb } from "./helpers.js";

useTestDb();
const app = makeApp();

describe("GET /categories", () => {
  it("requires a signed-in user", async () => {
    const res = await request(app).get("/categories");
    expect(res.status).toBe(401);
  });

  it("returns only active categories, sorted by name", async () => {
    await createCategory("Overflowing bin");
    await createCategory("Illegal dumping");
    await createCategory("Retired category", false);

    const res = await request(app).get("/categories").set(await authHeaderFor(app, Role.CITIZEN));
    expect(res.status).toBe(200);
    expect(res.body.map((c: { name: string }) => c.name)).toEqual(["Illegal dumping", "Overflowing bin"]);
    expect(res.body[0]).toMatchObject({ active: true, defaultPriority: "MEDIUM" });
  });
});
