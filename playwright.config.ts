import { defineConfig } from "@playwright/test";

export default defineConfig({
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    navigationTimeout: 45_000,
  },
});
