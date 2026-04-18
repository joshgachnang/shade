import {afterAll, afterEach, describe, expect, mock, test} from "bun:test";

// Save original env and fetch
const originalEnv = {...process.env};
const originalFetch = globalThis.fetch;

// Set env before importing server modules
process.env.MCP_AUTH_TOKEN = "test-token";
process.env.SONARR_URL = "http://sonarr:8989";
process.env.SONARR_API_KEY = "sonarr-key";
process.env.RADARR_URL = "http://radarr:7878";
process.env.RADARR_API_KEY = "radarr-key";
process.env.NZBGET_URL = "http://nzbget:6789";
process.env.PLEX_URL = "http://plex:32400";
process.env.PLEX_TOKEN = "plex-token";
process.env.MCP_PORT = "0";

import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {loadConfig} from "./config";
import {registerNzbgetTools} from "./tools/nzbget";
import {registerPlexTools} from "./tools/plex";
import {registerRadarrTools} from "./tools/radarr";
import {registerSonarrTools} from "./tools/sonarr";

// Internal type — _registeredTools is a plain object keyed by tool name
type ToolRegistry = Record<
  string,
  {handler: (...args: unknown[]) => Promise<{content: Array<{type: string; text: string}>}>}
>;
const getTools = (server: McpServer): ToolRegistry =>
  (server as unknown as {_registeredTools: ToolRegistry})._registeredTools;

afterAll(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const mockFetchJson = (body: unknown) => {
  globalThis.fetch = mock(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({"content-type": "application/json"}),
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
};

const makeServer = (): McpServer =>
  new McpServer({name: "test", version: "1.0.0"}, {capabilities: {tools: {}}});

// --- Registration tests ---

describe("McpServer tool registration", () => {
  test("registers all sonarr tools", () => {
    const server = makeServer();
    registerSonarrTools(server, {baseUrl: "http://sonarr:8989", apiKey: "key"});

    const toolNames = Object.keys(getTools(server)).sort();
    expect(toolNames).toContain("sonarr_search");
    expect(toolNames).toContain("sonarr_list_series");
    expect(toolNames).toContain("sonarr_add_series");
    expect(toolNames).toContain("sonarr_calendar");
    expect(toolNames).toContain("sonarr_queue");
    expect(toolNames).toContain("sonarr_queue_details");
    expect(toolNames).toContain("sonarr_episode_search");
    expect(toolNames).toContain("sonarr_manual_search");
    expect(toolNames).toContain("sonarr_grab_release");
    expect(toolNames).toContain("sonarr_history");
    expect(toolNames).toContain("sonarr_blocklist");
    expect(toolNames).toContain("sonarr_get_quality_profiles");
    expect(toolNames).toContain("sonarr_get_root_folders");
    expect(toolNames).toContain("sonarr_delete_series");
    expect(toolNames).toContain("sonarr_get_series");
  });

  test("registers all radarr tools", () => {
    const server = makeServer();
    registerRadarrTools(server, {baseUrl: "http://radarr:7878", apiKey: "key"});

    const toolNames = Object.keys(getTools(server)).sort();
    expect(toolNames).toContain("radarr_search");
    expect(toolNames).toContain("radarr_list_movies");
    expect(toolNames).toContain("radarr_add_movie");
    expect(toolNames).toContain("radarr_calendar");
    expect(toolNames).toContain("radarr_queue");
    expect(toolNames).toContain("radarr_queue_details");
    expect(toolNames).toContain("radarr_movie_search");
    expect(toolNames).toContain("radarr_manual_search");
    expect(toolNames).toContain("radarr_grab_release");
    expect(toolNames).toContain("radarr_history");
    expect(toolNames).toContain("radarr_blocklist");
    expect(toolNames).toContain("radarr_get_quality_profiles");
    expect(toolNames).toContain("radarr_get_root_folders");
    expect(toolNames).toContain("radarr_delete_movie");
    expect(toolNames).toContain("radarr_get_movie");
  });

  test("registers all nzbget tools", () => {
    const server = makeServer();
    registerNzbgetTools(server, {
      baseUrl: "http://nzbget:6789",
      username: "admin",
      password: "pass",
    });

    const toolNames = Object.keys(getTools(server)).sort();
    expect(toolNames).toContain("nzbget_status");
    expect(toolNames).toContain("nzbget_list_downloads");
    expect(toolNames).toContain("nzbget_history");
    expect(toolNames).toContain("nzbget_log");
    expect(toolNames).toContain("nzbget_pause");
    expect(toolNames).toContain("nzbget_resume");
    expect(toolNames).toContain("nzbget_set_speed_limit");
    expect(toolNames).toContain("nzbget_pause_item");
    expect(toolNames).toContain("nzbget_resume_item");
    expect(toolNames).toContain("nzbget_delete_item");
    expect(toolNames).toContain("nzbget_move_item");
  });

  test("registers all plex tools", () => {
    const server = makeServer();
    registerPlexTools(server, {baseUrl: "http://plex:32400", token: "token"});

    const toolNames = Object.keys(getTools(server)).sort();
    expect(toolNames).toContain("plex_libraries");
    expect(toolNames).toContain("plex_library_contents");
    expect(toolNames).toContain("plex_search");
    expect(toolNames).toContain("plex_recently_added");
    expect(toolNames).toContain("plex_on_deck");
    expect(toolNames).toContain("plex_get_metadata");
    expect(toolNames).toContain("plex_sessions");
    expect(toolNames).toContain("plex_refresh_library");
    expect(toolNames).toContain("plex_devices");
    expect(toolNames).toContain("plex_mark_watched");
    expect(toolNames).toContain("plex_mark_unwatched");
  });

  test("registers expected total number of tools across all services", () => {
    const server = makeServer();
    const config = loadConfig();

    if (config.sonarr) {
      registerSonarrTools(server, config.sonarr);
    }
    if (config.radarr) {
      registerRadarrTools(server, config.radarr);
    }
    if (config.nzbget) {
      registerNzbgetTools(server, config.nzbget);
    }
    if (config.plex) {
      registerPlexTools(server, config.plex);
    }

    const toolCount = Object.keys(getTools(server)).length;
    // 15 sonarr + 15 radarr + 11 nzbget + 11 plex = 52
    expect(toolCount).toBe(52);
  });
});

// --- Tool behavior tests ---

describe("sonarr_search tool", () => {
  test("returns numbered results with guide text", async () => {
    mockFetchJson([
      {
        title: "Breaking Bad",
        year: 2008,
        tvdbId: 81189,
        imdbId: "tt0903747",
        overview: "A chemistry teacher diagnosed with cancer...",
        seasonCount: 5,
        status: "ended",
        network: "AMC",
        genres: ["Drama", "Thriller"],
        ratings: {value: 9.5},
      },
      {
        title: "Breaking Bad: Original Minisodes",
        year: 2009,
        tvdbId: 999999,
        imdbId: null,
        overview: "Short web episodes",
        seasonCount: 1,
        status: "ended",
        network: "AMC",
        genres: ["Comedy"],
        ratings: {value: 7.0},
      },
    ]);

    const server = makeServer();
    registerSonarrTools(server, {baseUrl: "http://sonarr:8989", apiKey: "key"});

    const tools = getTools(server);
    const result = await tools.sonarr_search.handler({term: "Breaking Bad"}, {} as never);

    const text = result.content[0].text;
    expect(text).toContain('Found 2 results for "Breaking Bad"');
    expect(text).toContain("Use the tvdbId to add a series");
    expect(text).toContain('"#": 1');
    expect(text).toContain('"#": 2');
    expect(text).toContain('"tvdbId": 81189');
    expect(text).toContain("AMC");
  });

  test("returns empty message when no results found", async () => {
    mockFetchJson([]);

    const server = makeServer();
    registerSonarrTools(server, {baseUrl: "http://sonarr:8989", apiKey: "key"});

    const tools = getTools(server);
    const result = await tools.sonarr_search.handler({term: "xyznonexistent"}, {} as never);

    expect(result.content[0].text).toContain("No results found");
  });
});

describe("radarr_search tool", () => {
  test("returns numbered results with guide text", async () => {
    mockFetchJson([
      {
        title: "The Matrix",
        year: 1999,
        tmdbId: 603,
        imdbId: "tt0133093",
        overview: "A computer hacker learns...",
        runtime: 136,
        status: "released",
        isAvailable: true,
        genres: ["Action", "Sci-Fi"],
        ratings: {imdb: {value: 8.7}},
        studio: "Warner Bros",
      },
    ]);

    const server = makeServer();
    registerRadarrTools(server, {baseUrl: "http://radarr:7878", apiKey: "key"});

    const tools = getTools(server);
    const result = await tools.radarr_search.handler({term: "The Matrix"}, {} as never);

    const text = result.content[0].text;
    expect(text).toContain('Found 1 results for "The Matrix"');
    expect(text).toContain("Use the tmdbId to add a movie");
    expect(text).toContain('"tmdbId": 603');
  });
});

describe("sonarr_manual_search tool", () => {
  test("returns numbered releases with rejection info", async () => {
    mockFetchJson([
      {
        guid: "guid-1",
        title: "Breaking.Bad.S01E01.720p.BluRay",
        quality: {quality: {name: "Bluray-720p"}},
        size: 1073741824,
        indexer: "NZBgeek",
        seeders: null,
        leechers: null,
        ageMinutes: 14400,
        rejections: [],
        downloadAllowed: true,
        indexerId: 1,
        protocol: "usenet",
      },
      {
        guid: "guid-2",
        title: "Breaking.Bad.S01E01.1080p.WEB-DL",
        quality: {quality: {name: "WEBDL-1080p"}},
        size: 2147483648,
        indexer: "Dog",
        seeders: 50,
        leechers: 5,
        ageMinutes: 7200,
        rejections: ["Not in preferred word list"],
        downloadAllowed: false,
        indexerId: 2,
        protocol: "torrent",
      },
    ]);

    const server = makeServer();
    registerSonarrTools(server, {baseUrl: "http://sonarr:8989", apiKey: "key"});

    const tools = getTools(server);
    const result = await tools.sonarr_manual_search.handler({episodeId: 1}, {} as never);

    const text = result.content[0].text;
    expect(text).toContain("Found 2 releases");
    expect(text).toContain("sonarr_grab_release");
    expect(text).toContain('"guid": "guid-1"');
    expect(text).toContain('"size": "1.00 GB"');
    expect(text).toContain('"size": "2.00 GB"');
    expect(text).toContain('"rejected": false');
    expect(text).toContain('"rejected": true');
    expect(text).toContain("Not in preferred word list");
  });
});

describe("sonarr_history tool", () => {
  test("returns history with diagnostic details", async () => {
    mockFetchJson({
      records: [
        {
          id: 1,
          eventType: "downloadFailed",
          date: "2026-04-10T12:00:00Z",
          sourceTitle: "Breaking.Bad.S01E01.720p",
          quality: {quality: {name: "Bluray-720p"}},
          series: {title: "Breaking Bad"},
          episode: {title: "Pilot", seasonNumber: 1, episodeNumber: 1},
          data: {
            downloadClient: "NZBGet",
            indexer: "NZBgeek",
            message: "Download failed: missing articles",
            reason: "HealthCheck",
          },
        },
        {
          id: 2,
          eventType: "grabbed",
          date: "2026-04-10T11:00:00Z",
          sourceTitle: "Breaking.Bad.S01E01.1080p",
          quality: {quality: {name: "WEBDL-1080p"}},
          series: {title: "Breaking Bad"},
          episode: {title: "Pilot", seasonNumber: 1, episodeNumber: 1},
          data: {
            downloadClient: "NZBGet",
            indexer: "Dog",
          },
        },
      ],
    });

    const server = makeServer();
    registerSonarrTools(server, {baseUrl: "http://sonarr:8989", apiKey: "key"});

    const tools = getTools(server);
    const result = await tools.sonarr_history.handler({limit: 20}, {} as never);

    const text = result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].eventType).toBe("downloadFailed");
    expect(parsed[0].message).toBe("Download failed: missing articles");
    expect(parsed[0].reason).toBe("HealthCheck");
    expect(parsed[0].downloadClient).toBe("NZBGet");
    expect(parsed[1].eventType).toBe("grabbed");
  });
});

describe("nzbget_history tool", () => {
  test("returns history with failure diagnostics", async () => {
    mockFetchJson({
      result: [
        {
          NZBID: 1,
          Name: "Breaking.Bad.S01E01",
          Status: "FAILURE/UNPACK",
          FileSizeMB: 700,
          Category: "tv",
          ParStatus: "SUCCESS",
          UnpackStatus: "FAILURE",
          DeleteStatus: "NONE",
          MarkStatus: "NONE",
          DownloadTimeSec: 300,
          PostTotalTimeSec: 60,
          TotalArticles: 1000,
          SuccessArticles: 950,
          FailedArticles: 50,
          Health: 950,
          MoveStatus: "NONE",
          ScriptStatuses: [],
          FailMessage: "Unpack failed: wrong password",
          UrlStatus: "NONE",
          DupStatus: "NONE",
        },
      ],
    });

    const server = makeServer();
    registerNzbgetTools(server, {
      baseUrl: "http://nzbget:6789",
      username: "admin",
      password: "pass",
    });

    const tools = getTools(server);
    const result = await tools.nzbget_history.handler({limit: 20}, {} as never);

    const text = result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed[0].status).toBe("FAILURE/UNPACK");
    expect(parsed[0].parStatus).toBe("SUCCESS");
    expect(parsed[0].unpackStatus).toBe("FAILURE");
    expect(parsed[0].failMessage).toBe("Unpack failed: wrong password");
    expect(parsed[0].failedArticles).toBe(50);
  });
});

describe("queue tools include error fields", () => {
  test("sonarr_queue includes trackedDownloadStatus and errorMessage", async () => {
    mockFetchJson({
      records: [
        {
          id: 1,
          title: "Breaking.Bad.S01E01",
          status: "warning",
          size: 1073741824,
          sizeleft: 0,
          timeleft: "00:00:00",
          downloadClient: "NZBGet",
          indexer: "NZBgeek",
          trackedDownloadStatus: "warning",
          trackedDownloadState: "importPending",
          statusMessages: [{title: "Breaking.Bad.S01E01", messages: ["Episode not found"]}],
          errorMessage: "Import failed: episode not matched",
        },
      ],
    });

    const server = makeServer();
    registerSonarrTools(server, {baseUrl: "http://sonarr:8989", apiKey: "key"});

    const tools = getTools(server);
    const result = await tools.sonarr_queue.handler({}, {} as never);

    const text = result.content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed[0].trackedDownloadStatus).toBe("warning");
    expect(parsed[0].trackedDownloadState).toBe("importPending");
    expect(parsed[0].errorMessage).toBe("Import failed: episode not matched");
    expect(parsed[0].statusMessages).toBeDefined();
  });
});
