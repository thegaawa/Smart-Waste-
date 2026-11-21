import { z } from "zod";

/** PUT /devices */
export const registerDeviceSchema = z.object({
  token: z.string().trim().min(1, "Device token is required").max(4096, "Device token is too long"),
  platform: z.enum(["android", "ios"], { message: "Platform must be android or ios" }),
  appVersion: z.string().trim().min(1).max(50).optional(),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

/** DELETE /devices */
export const unregisterDeviceSchema = z.object({
  token: z.string().trim().min(1, "Device token is required").max(4096, "Device token is too long"),
});

export type UnregisterDeviceInput = z.infer<typeof unregisterDeviceSchema>;
