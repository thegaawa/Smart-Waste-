import { randomUUID } from "node:crypto";

import { Role, type ReportDetailDto } from "@smart-waste/shared";
import request, { type Response } from "supertest";
import { describe, expect, it } from "vitest";

import { signedMediaPath } from "../src/lib/media-urls.js";
import {
  JPEG_BYTES,
  bearer,
  createCategory,
  createUser,
  login,
  makeApp,
  postReport,
  reportFields,
  useTestDb,
} from "./helpers.js";

useTestDb();
const app = makeApp();

/** Collects a binary response body (supertest only parses text and JSON by itself). */
function binary(res: Response, callback: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

async function reportWithPhoto(): Promise<ReportDetailDto> {
  const user = await createUser({ role: Role.CITIZEN });
  const auth = bearer((await login(app, user.email as string)).accessToken);
  const category = await createCategory("Illegal dumping");
  const res = await postReport(app, auth, reportFields(category.id), [{ data: JPEG_BYTES, filename: "heap.jpg" }]);
  expect(res.status).toBe(201);
  return res.body as ReportDetailDto;
}

/** Path + query of an absolute URL, so the request goes to the in-process app. */
function pathOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

describe("GET /media/:id (signed photo links)", () => {
  it("serves the photo bytes with the right content type, no session needed", async () => {
    const report = await reportWithPhoto();
    const media = report.media[0];
    expect(media).toBeDefined();

    const res = await request(app).get(pathOf(media!.url)).buffer(true).parse(binary);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["content-length"]).toBe(String(JPEG_BYTES.length));
    expect(res.headers["cache-control"]).toBe("private, max-age=3600");
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(Buffer.compare(res.body as Buffer, JPEG_BYTES)).toBe(0);
  });

  it("refuses a link whose signature was changed", async () => {
    const report = await reportWithPhoto();
    const url = new URL(report.media[0]!.url);
    url.searchParams.set("sig", "x".repeat(43));

    const res = await request(app).get(pathOf(url.toString()));

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/not valid or has expired/);
  });

  it("refuses a link once it has expired", async () => {
    const report = await reportWithPhoto();
    const mediaId = report.media[0]!.id;
    const anHourAgo = Math.floor(Date.now() / 1000) - 3600;

    const res = await request(app).get(signedMediaPath(mediaId, anHourAgo));

    expect(res.status).toBe(403);
  });

  it("refuses a link with no signature at all", async () => {
    const report = await reportWithPhoto();
    const res = await request(app).get(`/media/${report.media[0]!.id}`);
    expect(res.status).toBe(403);
  });

  it("returns 404 for a correctly signed link to a photo that does not exist", async () => {
    const future = Math.floor(Date.now() / 1000) + 600;
    const res = await request(app).get(signedMediaPath(randomUUID(), future));
    expect(res.status).toBe(404);
  });
});
