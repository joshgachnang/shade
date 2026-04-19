/**
 * MCP media server configuration.
 *
 * Resolution order when using `loadConfigWithAppConfig()`:
 *   1. `process.env` (deploy environment)
 *   2. `AppConfig.mcpMedia` (MongoDB), when `MONGO_URI` is reachable
 *
 * All service configs are optional — tools for unconfigured services return a
 * helpful error instead of crashing. The sync `loadConfig()` variant is env-
 * only and kept for unit tests + standalone deployments without Mongo.
 */

export interface ServiceConfig {
  baseUrl: string;
  apiKey: string;
}

export interface NzbgetConfig {
  baseUrl: string;
  username: string;
  password: string;
}

export interface PlexConfig {
  baseUrl: string;
  token: string;
}

export interface MediaServerConfig {
  port: number;
  authToken: string;
  sonarr?: ServiceConfig;
  radarr?: ServiceConfig;
  nzbget?: NzbgetConfig;
  plex?: PlexConfig;
}

const firstNonEmpty = (...values: Array<string | undefined | null>): string | undefined => {
  for (const v of values) {
    if (v) {
      return v;
    }
  }
  return undefined;
};

/**
 * Synchronous, env-only config loader. Used by unit tests and by
 * `loadConfigWithAppConfig()` when Mongo isn't reachable.
 */
export const loadConfig = (): MediaServerConfig => {
  const authToken = process.env.MCP_AUTH_TOKEN;
  if (!authToken) {
    throw new Error("MCP_AUTH_TOKEN is required");
  }

  const config: MediaServerConfig = {
    port: Number.parseInt(process.env.MCP_PORT ?? "8081", 10),
    authToken,
  };

  if (process.env.SONARR_URL && process.env.SONARR_API_KEY) {
    config.sonarr = {
      baseUrl: process.env.SONARR_URL,
      apiKey: process.env.SONARR_API_KEY,
    };
  }

  if (process.env.RADARR_URL && process.env.RADARR_API_KEY) {
    config.radarr = {
      baseUrl: process.env.RADARR_URL,
      apiKey: process.env.RADARR_API_KEY,
    };
  }

  if (process.env.NZBGET_URL) {
    config.nzbget = {
      baseUrl: process.env.NZBGET_URL,
      username: process.env.NZBGET_USERNAME ?? "nzbget",
      password: process.env.NZBGET_PASSWORD ?? "",
    };
  }

  if (process.env.PLEX_URL && process.env.PLEX_TOKEN) {
    config.plex = {
      baseUrl: process.env.PLEX_URL,
      token: process.env.PLEX_TOKEN,
    };
  }

  return config;
};

/**
 * Async config loader that prefers env vars, then falls back to
 * `AppConfig.mcpMedia` in MongoDB. Connects to Mongo on-demand; if the
 * connection fails or `MONGO_URI` isn't set, silently falls through to
 * `loadConfig()` (pure env).
 */
export const loadConfigWithAppConfig = async (): Promise<MediaServerConfig> => {
  if (!process.env.MONGO_URI) {
    return loadConfig();
  }

  let mcpMedia: Awaited<ReturnType<typeof fetchAppConfigMcpMedia>> | null = null;
  try {
    mcpMedia = await fetchAppConfigMcpMedia();
  } catch (err) {
    console.warn(`[media-mcp] Could not read AppConfig (falling back to env): ${err}`);
    return loadConfig();
  }

  const authToken = firstNonEmpty(process.env.MCP_AUTH_TOKEN, mcpMedia?.authToken);
  if (!authToken) {
    throw new Error("MCP_AUTH_TOKEN is required (set env var or AppConfig.mcpMedia.authToken)");
  }

  const portRaw = firstNonEmpty(process.env.MCP_PORT, mcpMedia?.port ? String(mcpMedia.port) : "");
  const config: MediaServerConfig = {
    port: Number.parseInt(portRaw ?? "8081", 10),
    authToken,
  };

  const sonarrUrl = firstNonEmpty(process.env.SONARR_URL, mcpMedia?.sonarr?.baseUrl);
  const sonarrKey = firstNonEmpty(process.env.SONARR_API_KEY, mcpMedia?.sonarr?.apiKey);
  if (sonarrUrl && sonarrKey) {
    config.sonarr = {baseUrl: sonarrUrl, apiKey: sonarrKey};
  }

  const radarrUrl = firstNonEmpty(process.env.RADARR_URL, mcpMedia?.radarr?.baseUrl);
  const radarrKey = firstNonEmpty(process.env.RADARR_API_KEY, mcpMedia?.radarr?.apiKey);
  if (radarrUrl && radarrKey) {
    config.radarr = {baseUrl: radarrUrl, apiKey: radarrKey};
  }

  const nzbgetUrl = firstNonEmpty(process.env.NZBGET_URL, mcpMedia?.nzbget?.baseUrl);
  if (nzbgetUrl) {
    config.nzbget = {
      baseUrl: nzbgetUrl,
      username: firstNonEmpty(process.env.NZBGET_USERNAME, mcpMedia?.nzbget?.username) ?? "nzbget",
      password: firstNonEmpty(process.env.NZBGET_PASSWORD, mcpMedia?.nzbget?.password) ?? "",
    };
  }

  const plexUrl = firstNonEmpty(process.env.PLEX_URL, mcpMedia?.plex?.baseUrl);
  const plexToken = firstNonEmpty(process.env.PLEX_TOKEN, mcpMedia?.plex?.token);
  if (plexUrl && plexToken) {
    config.plex = {baseUrl: plexUrl, token: plexToken};
  }

  return config;
};

/**
 * Connects to MongoDB just long enough to read the `AppConfig.mcpMedia`
 * subdocument, then disconnects. Isolated in its own function so unit tests
 * that stub env can still import `config.ts` without pulling in Mongoose.
 */
const fetchAppConfigMcpMedia = async (): Promise<{
  authToken?: string;
  port?: number;
  sonarr?: {baseUrl?: string; apiKey?: string};
  radarr?: {baseUrl?: string; apiKey?: string};
  nzbget?: {baseUrl?: string; username?: string; password?: string};
  plex?: {baseUrl?: string; token?: string};
} | null> => {
  const {connectToMongoDB} = await import("../utils/database");
  const {loadAppConfig} = await import("../models/appConfig");
  await connectToMongoDB();
  const appConfig = await loadAppConfig();
  return appConfig.mcpMedia ?? null;
};
