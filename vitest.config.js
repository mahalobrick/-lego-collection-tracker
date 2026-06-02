import { defineConfig } from "vitest/config";

// Standalone test config (does not load the app's vite plugins / local-api middleware).
// jsdom gives us a real localStorage for the data-layer unit tests.
export default defineConfig({
  test: {
    environment: "jsdom",
    // src/ = app/data-layer tests; scripts/ = maintained dev-tooling tests (e.g. the
    // pure deriveValue ladder behind scripts/refresh-values.mjs).
    include: ["src/**/*.test.{js,jsx}", "scripts/**/*.test.mjs"],
  },
});
