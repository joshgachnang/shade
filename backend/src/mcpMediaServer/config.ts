/**
 * Configuration loaded from environment variables.
 * All service configs are optional — tools for unconfigured services will
 * return a helpful error message instead of crashing.
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
