import {logger} from "@terreno/api";
import type {AppConfigDocument} from "../types";

/**
 * Snapshot of the effective hydrated value for each field the last time
 * `hydrateEnvFromConfig` ran. Used by `warnOnRestartRequiredChanges` to tell
 * the user which runtime edits to AppConfig need a restart to take effect.
 *
 * Values are the resolved string that ended up in `process.env` (so a field
 * sourced from env wins over AppConfig, just like at boot).
 */
let hydratedSnapshot: Record<string, string> = {};

/**
 * Fields that are either (a) consumed at boot by TerrenoApp/@anthropic-ai
 * SDK/etc. and never re-read, or (b) bake into already-created filesystem
 * state. Changing these in AppConfig at runtime requires a restart.
 */
const RESTART_REQUIRED_FIELDS: Array<{envName: string; configPath: string}> = [
  {envName: "ANTHROPIC_API_KEY", configPath: "apiKeys.anthropic"},
  {envName: "OPENROUTER_API_KEY", configPath: "apiKeys.openRouter"},
  {envName: "DEEPGRAM_API_KEY", configPath: "apiKeys.deepgram"},
  {envName: "ACRCLOUD_ACCESS_KEY", configPath: "apiKeys.acrCloudAccessKey"},
  {envName: "ACRCLOUD_SECRET_KEY", configPath: "apiKeys.acrCloudSecretKey"},
  {envName: "GITHUB_TOKEN", configPath: "apiKeys.github"},
  {envName: "BRAVE_SEARCH_API_KEY", configPath: "apiKeys.braveSearch"},
  {envName: "EXA_API_KEY", configPath: "apiKeys.exa"},
  {envName: "TAVILY_API_KEY", configPath: "apiKeys.tavily"},
  {envName: "ANSWERER_MODEL", configPath: "models.answerer"},
  {envName: "DETECTOR_MODEL", configPath: "models.detector"},
  {envName: "SHADE_DATA_DIR", configPath: "dataDir"},
  {envName: "SHADE_PUBLIC_URL", configPath: "publicUrl"},
  {envName: "LOG_LEVEL", configPath: "logging.level"},
  {envName: "TOKEN_SECRET", configPath: "auth.tokenSecret"},
  {envName: "REFRESH_TOKEN_SECRET", configPath: "auth.refreshTokenSecret"},
];

/**
 * Populate `process.env` with values sourced from AppConfig. Env vars take
 * precedence (so CI and local `.env` files keep working), but any key that
 * isn't already set falls back to the corresponding AppConfig field.
 *
 * Called once at server boot, right after `loadAppConfig()`. This is the bridge
 * that lets us treat AppConfig as the primary source for service credentials
 * (per CLAUDE.local.md) without rewriting every SDK callsite to be async —
 * third-party SDKs like `@anthropic-ai/sdk` and `openai` read `process.env`
 * synchronously at construction time.
 */
export const hydrateEnvFromConfig = (config: AppConfigDocument): void => {
  const mapping: Array<[string, string | number | undefined]> = [
    // API credentials for third-party services
    ["ANTHROPIC_API_KEY", config.apiKeys?.anthropic],
    ["OPENROUTER_API_KEY", config.apiKeys?.openRouter],
    ["DEEPGRAM_API_KEY", config.apiKeys?.deepgram],
    ["ACRCLOUD_ACCESS_KEY", config.apiKeys?.acrCloudAccessKey],
    ["ACRCLOUD_SECRET_KEY", config.apiKeys?.acrCloudSecretKey],
    ["GITHUB_TOKEN", config.apiKeys?.github],
    ["BRAVE_SEARCH_API_KEY", config.apiKeys?.braveSearch],
    ["EXA_API_KEY", config.apiKeys?.exa],
    ["TAVILY_API_KEY", config.apiKeys?.tavily],
    // Anthropic model-name overrides used by trivia services. They're read at
    // module load, so hydration has to happen before those modules execute —
    // `server.ts` calls this before `startOrchestrator()`, which imports the
    // trivia services lazily.
    ["ANSWERER_MODEL", config.models?.answerer],
    ["DETECTOR_MODEL", config.models?.detector],
    // Former "bootstrap" values that can now live in AppConfig. Consumers read
    // these through lazy getters or post-hydration reconfiguration, so landing
    // them in process.env is enough to make everything pick them up.
    ["SHADE_DATA_DIR", config.dataDir],
    ["SHADE_PUBLIC_URL", config.publicUrl],
    ["LOG_LEVEL", config.logging?.level],
    ["TOKEN_SECRET", config.auth?.tokenSecret],
    ["REFRESH_TOKEN_SECRET", config.auth?.refreshTokenSecret],
  ];

  for (const [envName, configValue] of mapping) {
    if (!process.env[envName] && configValue !== undefined && configValue !== "") {
      process.env[envName] = String(configValue);
    }
  }

  // Snapshot the effective value (whatever ended up in process.env) so we can
  // detect drift against later AppConfig edits.
  const snapshot: Record<string, string> = {};
  for (const {envName} of RESTART_REQUIRED_FIELDS) {
    snapshot[envName] = process.env[envName] ?? "";
  }
  hydratedSnapshot = snapshot;
};

/**
 * Compare a freshly-loaded AppConfig against the values we hydrated at boot,
 * and log a warning for each field that needs a restart to take effect.
 * Called from the `post("save")` / `post("findOneAndUpdate")` hooks on the
 * AppConfig schema so admins get an immediate hint when they rotate a secret
 * or flip a credential.
 */
export const warnOnRestartRequiredChanges = (config: AppConfigDocument): void => {
  if (Object.keys(hydratedSnapshot).length === 0) {
    return; // Hydration hasn't happened yet (e.g. during app startup).
  }

  const changed: string[] = [];
  for (const {envName, configPath} of RESTART_REQUIRED_FIELDS) {
    const newConfigValue = readConfigPath(config, configPath);
    // A runtime edit only matters if the env var isn't overriding AppConfig;
    // if env is set, the change to AppConfig is a no-op until env is unset.
    const envOverride = process.env[envName];
    const effectiveNew = envOverride || newConfigValue;
    if (effectiveNew !== hydratedSnapshot[envName]) {
      changed.push(configPath);
    }
  }

  if (changed.length > 0) {
    logger.warn(
      `AppConfig updated: ${changed.join(", ")} changed — restart Shade for these to take effect.`
    );
  }
};

/**
 * Walk a dotted path like `"auth.tokenSecret"` on the AppConfig document and
 * return the value as a string (empty string if missing or falsy).
 */
const readConfigPath = (config: AppConfigDocument, dottedPath: string): string => {
  const parts = dottedPath.split(".");
  let value: unknown = config;
  for (const part of parts) {
    if (value && typeof value === "object" && part in value) {
      value = (value as Record<string, unknown>)[part];
    } else {
      return "";
    }
  }
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
};
