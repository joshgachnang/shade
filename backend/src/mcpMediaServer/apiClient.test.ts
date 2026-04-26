import {afterEach, describe, expect, mock, test} from "bun:test";
import {makeRequest, nzbgetRequest, plexRequest} from "./apiClient";

// Track calls manually since we replace globalThis.fetch
const originalFetch = globalThis.fetch;
let lastCalls: Array<[string, RequestInit]> = [];

const mockFetch = (status: number, body: unknown, contentType = "application/json") => {
  lastCalls = [];
  const mockFn = mock(async (url: string, init: RequestInit) => {
    lastCalls.push([url, init]);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({"content-type": contentType}),
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  });
  globalThis.fetch = mockFn as unknown as typeof fetch;
  return mockFn;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  lastCalls = [];
});

describe("makeRequest", () => {
  test("sends GET request with correct headers and API key", async () => {
    const fn = mockFetch(200, [{title: "Breaking Bad"}]);

    const result = await makeRequest("http://sonarr:8989", "/api/v3/series", "test-api-key");

    expect(fn).toHaveBeenCalledTimes(1);
    const [url, options] = lastCalls[0];
    expect(url).toBe("http://sonarr:8989/api/v3/series");
    expect((options.headers as Record<string, string>)["X-Api-Key"]).toBe("test-api-key");
    expect(options.method).toBe("GET");
    expect(result).toEqual([{title: "Breaking Bad"}]);
  });

  test("sends POST request with JSON body", async () => {
    mockFetch(200, {id: 1});

    await makeRequest("http://sonarr:8989", "/api/v3/series", "key", {
      method: "POST",
      body: {title: "Test"},
    });

    const [, options] = lastCalls[0];
    expect(options.method).toBe("POST");
    expect(options.body).toBe(JSON.stringify({title: "Test"}));
  });

  test("appends query params to URL", async () => {
    mockFetch(200, []);

    await makeRequest("http://sonarr:8989", "/api/v3/series/lookup", "key", {
      params: {term: "Breaking Bad"},
    });

    const [url] = lastCalls[0];
    expect(url).toContain("term=Breaking+Bad");
  });

  test("throws on non-OK response with status and body", async () => {
    mockFetch(404, "Not Found");

    await expect(makeRequest("http://sonarr:8989", "/api/v3/series/999", "key")).rejects.toThrow(
      "GET /api/v3/series/999 failed (404)"
    );
  });

  test("returns text for non-JSON content type", async () => {
    mockFetch(200, "plain text response", "text/plain");

    const result = await makeRequest("http://sonarr:8989", "/api/v3/health", "key");
    expect(result).toBe("plain text response");
  });

  test("merges custom headers", async () => {
    mockFetch(200, {});

    await makeRequest("http://sonarr:8989", "/api/v3/test", "key", {
      headers: {"X-Custom": "value"},
    });

    const [, options] = lastCalls[0];
    expect((options.headers as Record<string, string>)["X-Custom"]).toBe("value");
    expect((options.headers as Record<string, string>)["X-Api-Key"]).toBe("key");
  });
});

describe("nzbgetRequest", () => {
  test("sends JSON-RPC request with correct auth URL", async () => {
    mockFetch(200, {result: {DownloadRate: 1024}});

    const result = await nzbgetRequest("http://nzbget:6789", "admin", "pass123", "status");

    const [url, options] = lastCalls[0];
    expect(url).toBe("http://nzbget:6789/admin:pass123/jsonrpc");
    expect(options.method).toBe("POST");
    const body = JSON.parse(options.body as string);
    expect(body.method).toBe("status");
    expect(body.params).toEqual([]);
    expect(result).toEqual({DownloadRate: 1024});
  });

  test("passes params array to JSON-RPC", async () => {
    mockFetch(200, {result: true});

    await nzbgetRequest("http://nzbget:6789", "admin", "pass", "editqueue", [
      "GroupPause",
      "",
      [42],
    ]);

    const [, options] = lastCalls[0];
    const body = JSON.parse(options.body as string);
    expect(body.params).toEqual(["GroupPause", "", [42]]);
  });

  test("throws on HTTP error", async () => {
    mockFetch(500, "Internal Server Error");

    await expect(nzbgetRequest("http://nzbget:6789", "admin", "pass", "status")).rejects.toThrow(
      "NZBGet status failed (500)"
    );
  });

  test("throws on JSON-RPC error response", async () => {
    mockFetch(200, {error: {code: -1, message: "Access denied"}});

    await expect(nzbgetRequest("http://nzbget:6789", "admin", "wrong", "status")).rejects.toThrow(
      "NZBGet status error"
    );
  });

  test("strips trailing slash from base URL", async () => {
    mockFetch(200, {result: true});

    await nzbgetRequest("http://nzbget:6789/", "admin", "pass", "status");

    const [url] = lastCalls[0];
    expect(url).toBe("http://nzbget:6789/admin:pass/jsonrpc");
  });
});

describe("plexRequest", () => {
  test("sends request with X-Plex-Token as query param", async () => {
    mockFetch(200, {MediaContainer: {}});

    const result = await plexRequest("http://plex:32400", "/library/sections", "plex-token-123");

    const [url, options] = lastCalls[0];
    expect(url).toContain("X-Plex-Token=plex-token-123");
    expect((options.headers as Record<string, string>).Accept).toBe("application/json");
    expect(result).toEqual({MediaContainer: {}});
  });

  test("merges additional query params", async () => {
    mockFetch(200, {MediaContainer: {}});

    await plexRequest("http://plex:32400", "/hubs/search", "token", {
      params: {query: "Matrix", limit: "10"},
    });

    const [url] = lastCalls[0];
    expect(url).toContain("query=Matrix");
    expect(url).toContain("limit=10");
    expect(url).toContain("X-Plex-Token=token");
  });

  test("throws on non-OK response", async () => {
    mockFetch(401, "Unauthorized");

    await expect(
      plexRequest("http://plex:32400", "/library/sections", "bad-token")
    ).rejects.toThrow("Plex GET /library/sections failed (401)");
  });
});
