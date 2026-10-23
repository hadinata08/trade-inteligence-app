import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@iti/shared": path.resolve("packages/shared/src/index.ts"),
      "@iti/database": path.resolve("packages/database/src/index.ts"),
      "@iti/comtrade": path.resolve("packages/comtrade/src/index.ts"),
      "@iti/analytics": path.resolve("packages/analytics/src/index.ts"),
      "@iti/excel": path.resolve("packages/excel/src/index.ts"),
    },
  },
});
