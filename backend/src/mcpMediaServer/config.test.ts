import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {loadConfig} from "./config";

// Save and restore env vars around each test
const savedEnv: Record<string, string | undefined> = {};
const envKeys = [
  "MCP_AUTH_TOKEN",
  "MCP_PORT",
  "SONARR_URL",
  "SONARR_API_KEY",
  "RADARR_URL",
  "RADARR_API_KEY",
  "NZBGET_URL",
  "NZBGET_USERNAME",
  "NZBGET_PASSWORD",
  "PLEX_URL",
  "PLEX_TOKEN",
];

beforeEach(() => {
  for (const key of envKeys) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of envKeys) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
});

describe("loadConfig", () => {
  test("throws when MCP_AUTH_TOKEN is missing", () => {
    expect(() => loadConfig()).toThrow("MCP_AUTH_TOKEN is required");
  });

  test("returns minimal config with only auth token", () => {
    process.env.MCP_AUTH_TOKEN = "secret";

    const config = loadConfig();

    expect(config.authToken).toBe("secret");
    expect(config.port).toBe(8081);
    expect(config.sonarr).toBeUndefined();
    expect(config.radarr).toBeUndefined();
    expect(config.nzbget).toBeUndefined();
    expect(config.plex).toBeUndefined();
  });

  test("reads custom port", () => {
    process.env.MCP_AUTH_TOKEN = "secret";
    process.env.MCP_PORT = "9090";

    const config = loadConfig();

    expect(config.port).toBe(9090);
  });

  test("configures sonarr when both URL and API key are set", () => {
    process.env.MCP_AUTH_TOKEN = "secret";
    process.env.SONARR_URL = "http://sonarr:8989";
    process.env.SONARR_API_KEY = "sonarr-key";

    const config = loadConfig();

    expect(config.sonarr).toEqual({
      baseUrl: "http://sonarr:8989",
      apiKey: "sonarr-key",
    });
  });

  test("skips sonarr when API key is missing", () => {
    process.env.MCP_AUTH_TOKEN = "secret";
    process.env.SONARR_URL = "http://sonarr:8989";

    const config = loadConfig();

    expect(config.sonarr).toBeUndefined();
  });

  test("configures radarr when both URL and API key are set", () => {
    process.env.MCP_AUTH_TOKEN = "secret";
    process.env.RADARR_URL = "http://radarr:7878";
    process.env.RADARR_API_KEY = "radarr-key";

    const config = loadConfig();

    expect(config.radarr).toEqual({
      baseUrl: "http://radarr:7878",
      apiKey: "radarr-key",
    });
  });

  test("configures nzbget with defaults when only URL is set", () => {
    process.env.MCP_AUTH_TOKEN = "secret";
    process.env.NZBGET_URL = "http://nzbget:6789";

    const config = loadConfig();

    expect(config.nzbget).toEqual({
      baseUrl: "http://nzbget:6789",
      username: "nzbget",
      password: "",
    });
  });

  test("configures nzbget with custom credentials", () => {
    process.env.MCP_AUTH_TOKEN = "secret";
    process.env.NZBGET_URL = "http://nzbget:6789";
    process.env.NZBGET_USERNAME = "admin";
    process.env.NZBGET_PASSWORD = "hunter2";

    const config = loadConfig();

    expect(config.nzbget).toEqual({
      baseUrl: "http://nzbget:6789",
      username: "admin",
      password: "hunter2",
    });
  });

  test("configures plex when both URL and token are set", () => {
    process.env.MCP_AUTH_TOKEN = "secret";
    process.env.PLEX_URL = "http://plex:32400";
    process.env.PLEX_TOKEN = "plex-token";

    const config = loadConfig();

    expect(config.plex).toEqual({
      baseUrl: "http://plex:32400",
      token: "plex-token",
    });
  });

  test("skips plex when token is missing", () => {
    process.env.MCP_AUTH_TOKEN = "secret";
    process.env.PLEX_URL = "http://plex:32400";

    const config = loadConfig();

    expect(config.plex).toBeUndefined();
  });

  test("configures all services simultaneously", () => {
    process.env.MCP_AUTH_TOKEN = "secret";
    process.env.SONARR_URL = "http://sonarr:8989";
    process.env.SONARR_API_KEY = "s-key";
    process.env.RADARR_URL = "http://radarr:7878";
    process.env.RADARR_API_KEY = "r-key";
    process.env.NZBGET_URL = "http://nzbget:6789";
    process.env.PLEX_URL = "http://plex:32400";
    process.env.PLEX_TOKEN = "p-token";

    const config = loadConfig();

    expect(config.sonarr).toBeDefined();
    expect(config.radarr).toBeDefined();
    expect(config.nzbget).toBeDefined();
    expect(config.plex).toBeDefined();
  });
});
