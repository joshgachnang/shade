import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {plexRequest} from "../apiClient";
import type {PlexConfig} from "../config";

interface PlexMediaContainer {
  MediaContainer?: {
    size?: number;
    Directory?: Array<Record<string, unknown>>;
    Metadata?: Array<Record<string, unknown>>;
    Device?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
}

export const registerPlexTools = (server: McpServer, config: PlexConfig) => {
  const api = (path: string, options?: {method?: string; params?: Record<string, string>}) =>
    plexRequest(config.baseUrl, path, config.token, options) as Promise<PlexMediaContainer>;

  server.tool(
    "plex_libraries",
    "List all Plex libraries (sections) with their types and item counts.",
    {},
    async () => {
      const result = await api("/library/sections");
      const libraries = (result.MediaContainer?.Directory ?? []).map((d) => ({
        key: d.key,
        title: d.title,
        type: d.type,
        agent: d.agent,
        scanner: d.scanner,
        refreshing: d.refreshing,
      }));
      return {content: [{type: "text", text: JSON.stringify(libraries, null, 2)}]};
    }
  );

  server.tool(
    "plex_library_contents",
    "Get the contents of a specific Plex library.",
    {
      sectionKey: z.string().describe("Library section key (get from plex_libraries)"),
      start: z.number().default(0).describe("Starting index for pagination"),
      size: z.number().default(50).describe("Number of items to return (max 50)"),
    },
    async ({sectionKey, start, size}) => {
      const result = await api(`/library/sections/${sectionKey}/all`, {
        params: {
          "X-Plex-Container-Start": String(start),
          "X-Plex-Container-Size": String(Math.min(size, 50)),
        },
      });
      const items = (result.MediaContainer?.Metadata ?? []).map((m) => ({
        ratingKey: m.ratingKey,
        title: m.title,
        year: m.year,
        type: m.type,
        addedAt: m.addedAt,
        updatedAt: m.updatedAt,
        viewCount: m.viewCount,
        lastViewedAt: m.lastViewedAt,
        rating: m.audienceRating ?? m.rating,
        summary: typeof m.summary === "string" ? m.summary.slice(0, 150) : "",
      }));
      return {content: [{type: "text", text: JSON.stringify(items, null, 2)}]};
    }
  );

  server.tool(
    "plex_search",
    "Search across all Plex libraries for movies, shows, episodes, or artists.",
    {
      query: z.string().describe("Search query"),
      limit: z.number().default(10).describe("Max number of results (default: 10)"),
    },
    async ({query, limit}) => {
      const result = await api("/hubs/search", {
        params: {query, limit: String(limit)},
      });
      // Search returns hubs with different media types
      const container = result.MediaContainer as Record<string, unknown> | undefined;
      const hubs = (container?.Hub as Array<Record<string, unknown>> | undefined) ?? [];
      const allResults: Array<Record<string, unknown>> = [];
      for (const hub of hubs) {
        const metadata = (hub.Metadata as Array<Record<string, unknown>> | undefined) ?? [];
        for (const m of metadata) {
          allResults.push({
            type: hub.type,
            ratingKey: m.ratingKey,
            title: m.title,
            year: m.year,
            summary: typeof m.summary === "string" ? m.summary.slice(0, 150) : "",
          });
        }
      }
      return {content: [{type: "text", text: JSON.stringify(allResults.slice(0, limit), null, 2)}]};
    }
  );

  server.tool(
    "plex_recently_added",
    "Get recently added items from a specific Plex library or across all libraries.",
    {
      sectionKey: z.string().optional().describe("Library section key. Omit for all libraries."),
      limit: z.number().default(20).describe("Number of items (default: 20)"),
    },
    async ({sectionKey, limit}) => {
      const path = sectionKey
        ? `/library/sections/${sectionKey}/recentlyAdded`
        : "/library/recentlyAdded";
      const result = await api(path, {
        params: {"X-Plex-Container-Size": String(limit)},
      });
      const items = (result.MediaContainer?.Metadata ?? []).map((m) => ({
        ratingKey: m.ratingKey,
        title: m.title,
        year: m.year,
        type: m.type,
        addedAt: m.addedAt,
        parentTitle: m.parentTitle,
        grandparentTitle: m.grandparentTitle,
      }));
      return {content: [{type: "text", text: JSON.stringify(items, null, 2)}]};
    }
  );

  server.tool("plex_on_deck", "Get items on deck (continue watching) from Plex.", {}, async () => {
    const result = await api("/library/onDeck");
    const items = (result.MediaContainer?.Metadata ?? []).map((m) => ({
      ratingKey: m.ratingKey,
      title: m.title,
      type: m.type,
      parentTitle: m.parentTitle,
      grandparentTitle: m.grandparentTitle,
      viewOffset: m.viewOffset,
      duration: m.duration,
    }));
    return {content: [{type: "text", text: JSON.stringify(items, null, 2)}]};
  });

  server.tool(
    "plex_get_metadata",
    "Get detailed metadata for a specific Plex item (movie, show, episode, etc.).",
    {ratingKey: z.string().describe("Plex rating key for the item")},
    async ({ratingKey}) => {
      const result = await api(`/library/metadata/${ratingKey}`);
      const metadata = result.MediaContainer?.Metadata?.[0];
      if (!metadata) {
        return {content: [{type: "text", text: "Item not found."}]};
      }
      return {content: [{type: "text", text: JSON.stringify(metadata, null, 2)}]};
    }
  );

  server.tool(
    "plex_sessions",
    "Get active Plex playback sessions (who is currently watching what).",
    {},
    async () => {
      const result = await api("/status/sessions");
      const sessions = (result.MediaContainer?.Metadata ?? []).map((m) => ({
        title: m.title,
        grandparentTitle: m.grandparentTitle,
        type: m.type,
        user: (m.User as Record<string, unknown> | undefined)?.title,
        player: (m.Player as Record<string, unknown> | undefined)?.title,
        state: (m.Player as Record<string, unknown> | undefined)?.state,
        viewOffset: m.viewOffset,
        duration: m.duration,
        device: (m.Player as Record<string, unknown> | undefined)?.device,
      }));
      return {content: [{type: "text", text: JSON.stringify(sessions, null, 2)}]};
    }
  );

  server.tool(
    "plex_refresh_library",
    "Trigger a library scan/refresh for a specific Plex library section.",
    {sectionKey: z.string().describe("Library section key to refresh")},
    async ({sectionKey}) => {
      await api(`/library/sections/${sectionKey}/refresh`);
      return {content: [{type: "text", text: `Library section ${sectionKey} refresh started.`}]};
    }
  );

  server.tool("plex_devices", "List connected Plex devices/players.", {}, async () => {
    const result = await api("/devices");
    const devices = (result.MediaContainer?.Device ?? []).map((d) => ({
      name: d.name,
      product: d.product,
      platform: d.platform,
      clientIdentifier: d.clientIdentifier,
      provides: d.provides,
      lastSeenAt: d.lastSeenAt,
    }));
    return {content: [{type: "text", text: JSON.stringify(devices, null, 2)}]};
  });

  server.tool(
    "plex_mark_watched",
    "Mark an item as watched in Plex.",
    {ratingKey: z.string().describe("Plex rating key for the item")},
    async ({ratingKey}) => {
      await api("/:/scrobble", {
        params: {identifier: "com.plexapp.plugins.library", key: ratingKey},
      });
      return {content: [{type: "text", text: `Item ${ratingKey} marked as watched.`}]};
    }
  );

  server.tool(
    "plex_mark_unwatched",
    "Mark an item as unwatched in Plex.",
    {ratingKey: z.string().describe("Plex rating key for the item")},
    async ({ratingKey}) => {
      await api("/:/unscrobble", {
        params: {identifier: "com.plexapp.plugins.library", key: ratingKey},
      });
      return {content: [{type: "text", text: `Item ${ratingKey} marked as unwatched.`}]};
    }
  );
};
