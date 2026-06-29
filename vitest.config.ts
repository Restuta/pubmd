import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // CLI integration tests spawn `tsx` per command; its cold start can push a
    // multi-command test past the 5s default on slower/CI machines.
    testTimeout: 30000,
  },
});
