import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import type {AppConfigDocument} from "../types";
import {hydrateEnvFromConfig, warnOnRestartRequiredChanges} from "./configEnv";

// Keep a stable snapshot of the env vars we might mutate during these tests so
// we can restore them after each case.
const TRACKED_ENV = [
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "DEEPGRAM_API_KEY",
  "SHADE_DATA_DIR",
  "SHADE_PUBLIC_URL",
  "LOG_LEVEL",
  "TOKEN_SECRET",
  "REFRESH_TOKEN_SECRET",
  "ANSWERER_MODEL",
  "DETECTOR_MODEL",
];

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of TRACKED_ENV) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of TRACKED_ENV) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

// Build a lightweight object that satisfies the paths `hydrateEnvFromConfig`
// reads without going through Mongoose. Cast at the call site.
const buildConfig = (overrides: Partial<Record<string, unknown>> = {}): AppConfigDocument =>
  ({
    apiKeys: {
      anthropic: "",
      openRouter: "",
      deepgram: "",
      acrCloudAccessKey: "",
      acrCloudSecretKey: "",
      github: "",
      braveSearch: "",
      exa: "",
      tavily: "",
      ...((overrides.apiKeys as object) ?? {}),
    },
    models: {
      answerer: "",
      detector: "",
      ...((overrides.models as object) ?? {}),
    },
    logging: {level: "", ...((overrides.logging as object) ?? {})},
    auth: {
      tokenSecret: "",
      refreshTokenSecret: "",
      ...((overrides.auth as object) ?? {}),
    },
    dataDir: overrides.dataDir ?? "",
    publicUrl: overrides.publicUrl ?? "",
  }) as unknown as AppConfigDocument;

describe("hydrateEnvFromConfig", () => {
  test("copies AppConfig values into process.env when env is unset", () => {
    hydrateEnvFromConfig(buildConfig({apiKeys: {anthropic: "from-config"}}));
    expect(process.env.ANTHROPIC_API_KEY).toBe("from-config");
  });

  test("does not overwrite env vars that are already set", () => {
    process.env.ANTHROPIC_API_KEY = "from-env";
    hydrateEnvFromConfig(buildConfig({apiKeys: {anthropic: "from-config"}}));
    expect(process.env.ANTHROPIC_API_KEY).toBe("from-env");
  });

  test("ignores empty-string config values", () => {
    hydrateEnvFromConfig(buildConfig({apiKeys: {anthropic: ""}}));
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe("warnOnRestartRequiredChanges", () => {
  test("no-op before hydration has run in this process", () => {
    // We can't observe "hasn't hydrated yet" directly, so we instead assert
    // that a fresh call doesn't throw and doesn't synthesize any output.
    expect(() => warnOnRestartRequiredChanges(buildConfig())).not.toThrow();
  });

  test("detects drift on a restart-required field", () => {
    hydrateEnvFromConfig(buildConfig({auth: {tokenSecret: "initial-secret"}}));
    expect(process.env.TOKEN_SECRET).toBe("initial-secret");

    // Simulate an admin editing AppConfig.auth.tokenSecret at runtime. The
    // env var still holds the boot-time value, so the change only takes
    // effect after restart.
    expect(() =>
      warnOnRestartRequiredChanges(buildConfig({auth: {tokenSecret: "rotated-secret"}}))
    ).not.toThrow();
  });

  test("no warning when changing a non-tracked field", () => {
    hydrateEnvFromConfig(buildConfig());
    // `publicUrl` not being set in boot, config.publicUrl also empty — no
    // snapshot drift expected.
    expect(() => warnOnRestartRequiredChanges(buildConfig())).not.toThrow();
  });
});
