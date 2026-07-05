import path from "node:path";

/**
 * Test-mode gate for the AI testability harness (IP-012).
 *
 * `SHADE_TEST_MODE` is deliberately an env var, not an AppConfig field: it must
 * decide connector wiring, runner selection, and service startup before (and
 * independent of) the database, which is the bootstrap exception to the
 * "all config lives in AppConfig" rule. Everything runtime-tunable about the
 * harness (fixtures, echo fallback, simulated latency) lives in AppConfig.
 */
export const isTestMode = (): boolean => {
  const value = process.env.SHADE_TEST_MODE;
  return value === "1" || value === "true";
};

/**
 * Sandbox defaults applied at the very top of `boot()` in test mode, before
 * Mongo connects or env hydration runs. Env vars already set (CI, bun test
 * preload's in-memory Mongo URI) always win — these only fill gaps, so a
 * credential-less `bun run dev:test` lands on an isolated database and data
 * directory instead of the real ones.
 */
export const applyTestModeEnvDefaults = (): void => {
  if (!isTestMode()) {
    return;
  }
  if (!process.env.MONGO_URI) {
    process.env.MONGO_URI = "mongodb://localhost:27017/shade-test";
  }
  if (!process.env.SHADE_DATA_DIR) {
    process.env.SHADE_DATA_DIR = path.join(process.cwd(), "data-test");
  }
};
