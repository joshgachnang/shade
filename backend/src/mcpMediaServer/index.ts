/**
 * Standalone MCP Media Server
 *
 * An HTTP-based MCP server that exposes tools for controlling Sonarr, Radarr,
 * NZBGet, and Plex. Designed to be run independently and exposed via
 * Cloudflare Tunnels for remote access.
 *
 * Auth: Bearer token via Authorization header.
 * Transport: Streamable HTTP (MCP spec) at /mcp.
 *
 * Usage:
 *   MCP_AUTH_TOKEN=secret bun run src/mcpMediaServer/index.ts
 *
 * Then expose with:
 *   cloudflared tunnel --url http://localhost:8081
 */

import {randomUUID} from "node:crypto";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {WebStandardStreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {loadConfig} from "./config";
import {registerNzbgetTools} from "./tools/nzbget";
import {registerPlexTools} from "./tools/plex";
import {registerRadarrTools} from "./tools/radarr";
import {registerSonarrTools} from "./tools/sonarr";

// --- Load config ---
const config = loadConfig();

// --- Build MCP server with tools ---
const createMcpServer = (): McpServer => {
  const server = new McpServer(
    {name: "shade-media", version: "1.0.0"},
    {capabilities: {tools: {}}}
  );

  if (config.sonarr) {
    registerSonarrTools(server, config.sonarr);
    console.info("[media-mcp] Sonarr tools registered");
  }

  if (config.radarr) {
    registerRadarrTools(server, config.radarr);
    console.info("[media-mcp] Radarr tools registered");
  }

  if (config.nzbget) {
    registerNzbgetTools(server, config.nzbget);
    console.info("[media-mcp] NZBGet tools registered");
  }

  if (config.plex) {
    registerPlexTools(server, config.plex);
    console.info("[media-mcp] Plex tools registered");
  }

  return server;
};

// --- Auth helper ---
const validateAuth = (req: Request): boolean => {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return false;
  }
  const [scheme, token] = authHeader.split(" ");
  return scheme === "Bearer" && token === config.authToken;
};

const jsonRpcError = (code: number, message: string, status: number): Response =>
  Response.json({jsonrpc: "2.0", error: {code, message}, id: null}, {status});

// --- Session management ---
// Each session gets its own transport + McpServer instance
const sessions = new Map<
  string,
  {transport: WebStandardStreamableHTTPServerTransport; server: McpServer}
>();

// --- Bun HTTP server ---
Bun.serve({
  port: config.port,
  hostname: "0.0.0.0",
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Health check — no auth required
    if (url.pathname === "/health") {
      return Response.json({status: "ok", server: "shade-media-mcp"});
    }

    // Only serve /mcp
    if (url.pathname !== "/mcp") {
      return new Response("Not found", {status: 404});
    }

    // Auth check for all /mcp requests
    if (!validateAuth(req)) {
      return jsonRpcError(-32001, "Unauthorized", 401);
    }

    // --- POST /mcp ---
    if (req.method === "POST") {
      const body = (await req.json()) as Record<string, unknown> | Array<Record<string, unknown>>;
      const sessionId = req.headers.get("mcp-session-id");

      // Detect initialize request
      const isInitialize = Array.isArray(body)
        ? body.some((msg) => msg.method === "initialize")
        : body.method === "initialize";

      if (isInitialize) {
        // Create a new session: transport + server
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            sessions.set(sid, {transport, server: mcpServer});
            console.info(`[media-mcp] Session initialized: ${sid}`);
          },
          onsessionclosed: (sid) => {
            sessions.delete(sid);
            console.info(`[media-mcp] Session closed: ${sid}`);
          },
        });

        const mcpServer = createMcpServer();
        await mcpServer.connect(transport);

        return transport.handleRequest(req, {parsedBody: body});
      }

      // Existing session
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session) {
        return jsonRpcError(
          -32000,
          "Bad Request: No valid session. Send an initialize request first.",
          400
        );
      }

      return session.transport.handleRequest(req, {parsedBody: body});
    }

    // --- GET /mcp — SSE stream for server notifications ---
    if (req.method === "GET") {
      const sessionId = req.headers.get("mcp-session-id");
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (!session) {
        return jsonRpcError(-32000, "No valid session.", 400);
      }
      return session.transport.handleRequest(req);
    }

    // --- DELETE /mcp — Close session ---
    if (req.method === "DELETE") {
      const sessionId = req.headers.get("mcp-session-id");
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (session) {
        await session.server.close();
        sessions.delete(sessionId!);
      }
      return new Response(null, {status: 204});
    }

    return new Response("Method not allowed", {status: 405});
  },
});

console.info(`[media-mcp] Server running on http://0.0.0.0:${config.port}/mcp`);
console.info("[media-mcp] Health check at /health");
console.info(`[media-mcp] Expose via: cloudflared tunnel --url http://localhost:${config.port}`);
