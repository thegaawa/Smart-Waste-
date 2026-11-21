/// <reference types="node" />
// This file runs in Node (Expo CLI), not in the app, so Node APIs are fine here.
import type { ConfigContext, ExpoConfig } from "expo/config";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Extends app.json at build time.
 *
 * Android blocks plain `http://` traffic in release builds. During development
 * and LAN demos the API runs on `http://<your-computer>:4000`, so cleartext is
 * allowed only when the API address is not HTTPS. A production build with
 * `EXPO_PUBLIC_API_URL=https://…` keeps the secure default.
 *
 * Push notifications need the Firebase file `google-services.json` next to
 * this file (download it from the Firebase console; it is git-ignored). When
 * it is present it is wired in automatically; without it the app still builds
 * and notifications stay in-app only.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim() ?? "";
  const allowCleartext = !apiUrl.toLowerCase().startsWith("https://");

  const projectDir = typeof __dirname === "string" ? __dirname : process.cwd();
  const googleServicesFile = path.join(projectDir, "google-services.json");
  const hasFirebase = existsSync(googleServicesFile);

  return {
    ...config,
    name: config.name ?? "Smart-Waste",
    slug: config.slug ?? "smart-waste",
    android: {
      ...config.android,
      ...(hasFirebase ? { googleServicesFile: "./google-services.json" } : {}),
    },
    plugins: [
      ...(config.plugins ?? []),
      ["expo-build-properties", { android: { usesCleartextTraffic: allowCleartext } }],
    ],
  };
};
