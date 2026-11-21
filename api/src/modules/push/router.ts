import { Router } from "express";

import type { Db } from "../../db.js";
import { parseBody } from "../../lib/validate.js";
import { currentUser, requireAuth } from "../../middleware/auth.js";
import { registerDeviceSchema, unregisterDeviceSchema } from "./schemas.js";
import type { PushService } from "./service.js";

/** /devices — phones register for push notifications; any signed-in role. */
export function devicesRouter(db: Db, push: PushService): Router {
  const router = Router();

  router.use(requireAuth(db));

  // PUT /devices { token, platform, appVersion? } — idempotent; re-sent on every app start.
  router.put("/", async (req, res) => {
    const input = parseBody(registerDeviceSchema, req.body);
    await push.registerDevice(currentUser(req), input);
    res.status(204).end();
  });

  // DELETE /devices { token } — on sign out.
  router.delete("/", async (req, res) => {
    const input = parseBody(unregisterDeviceSchema, req.body);
    await push.unregisterDevice(currentUser(req), input);
    res.status(204).end();
  });

  return router;
}
