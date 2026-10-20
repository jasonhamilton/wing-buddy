import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

/**
 * Vitest owns `src/**`; Playwright owns `e2e/**`. Kept in its own file because
 * vite's own config type does not carry a `test` key — putting it there
 * typechecks only by accident.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      exclude: ["e2e/**", "node_modules/**", "dist/**"],
    },
  }),
);
