import type {AppConfigDocument} from "../types";

/**
 * Populate `process.env` with API keys sourced from AppConfig. Env vars take
 * precedence (so CI and local `.env` files keep working), but any key that
 * isn't already set falls back to the corresponding `AppConfig.apiKeys` field.
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
};
