import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup.ts"],
    // All test files share one database, so run them one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 90_000,
    teardownTimeout: 20_000,
  },
});
