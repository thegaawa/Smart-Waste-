import { pipeline } from "node:stream/promises";
import { Router } from "express";
import { z } from "zod";

import type { Db } from "../../db.js";
import { ApiError } from "../../lib/errors.js";
import { verifyMediaSignature } from "../../lib/media-urls.js";
import type { ObjectStorage } from "../../lib/storage.js";
import { parseParams } from "../../lib/validate.js";

const idParamsSchema = z.object({ id: z.uuid("Invalid photo id") });

/**
 * GET /media/:id?exp=…&sig=… — serves a report photo through a signed,
 * time-limited link produced by the API (see lib/media-urls.ts). No session
 * is needed, which lets image components and <img> tags load photos directly.
 */
export function mediaRouter(db: Db, storage: ObjectStorage): Router {
  const router = Router();

  router.get("/:id", async (req, res) => {
    const { id } = parseParams(idParamsSchema, req.params);
    if (!verifyMediaSignature(id, req.query["exp"], req.query["sig"])) {
      throw ApiError.forbidden("This photo link is not valid or has expired");
    }

    const media = await db.reportMedia.findUnique({ where: { id } });
    if (!media) throw ApiError.notFound("Photo");

    const object = await storage.open(media.storageKey);
    if (!object) throw ApiError.notFound("Photo");

    res.status(200);
    res.setHeader("Content-Type", media.mimeType);
    res.setHeader("Content-Length", String(object.size));
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, max-age=3600");

    try {
      await pipeline(object.stream, res);
    } catch (error) {
      // The client went away mid-download: nothing to report. Anything else
      // that happens before the first byte is a real error.
      if (!res.headersSent) throw error;
    }
  });

  return router;
}
