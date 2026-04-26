import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {makeRequest} from "../apiClient";
import type {ServiceConfig} from "../config";

export const registerSonarrTools = (server: McpServer, config: ServiceConfig) => {
  const api = (path: string, options?: Parameters<typeof makeRequest>[3]) =>
    makeRequest(config.baseUrl, `/api/v3${path}`, config.apiKey, options);

  server.tool(
    "sonarr_search",
    "Search for TV series by name. Returns numbered results you can reference when adding.",
    {term: z.string().describe("Search term (e.g. 'Breaking Bad')")},
    async ({term}) => {
      const results = await api("/series/lookup", {params: {term}});
      const series = (results as Array<Record<string, unknown>>).slice(0, 15).map((s, i) => ({
        "#": i + 1,
        title: s.title,
        year: s.year,
        tvdbId: s.tvdbId,
        imdbId: s.imdbId,
        overview: typeof s.overview === "string" ? s.overview.slice(0, 300) : "",
        seasonCount: s.seasonCount,
        status: s.status,
        network: s.network,
        genres: (s.genres as string[] | undefined)?.join(", ") ?? "",
        ratings: (s.ratings as Record<string, unknown>)?.value ?? null,
      }));
      if (!series.length) {
        return {content: [{type: "text", text: `No results found for "${term}".`}]};
      }
      const header = `Found ${series.length} results for "${term}". Use the tvdbId to add a series.\n\n`;
      return {content: [{type: "text", text: header + JSON.stringify(series, null, 2)}]};
    }
  );

  server.tool(
    "sonarr_list_series",
    "List all TV series currently monitored in Sonarr.",
    {},
    async () => {
      const results = await api("/series");
      const series = (results as Array<Record<string, unknown>>).map((s) => ({
        id: s.id,
        title: s.title,
        year: s.year,
        status: s.status,
        monitored: s.monitored,
        seasonCount: s.seasonCount,
        episodeFileCount: s.episodeFileCount,
        totalEpisodeCount: s.totalEpisodeCount,
        sizeOnDisk: s.sizeOnDisk,
        qualityProfileId: s.qualityProfileId,
      }));
      return {content: [{type: "text", text: JSON.stringify(series, null, 2)}]};
    }
  );

  server.tool(
    "sonarr_get_series",
    "Get detailed information about a specific series in Sonarr by its ID.",
    {seriesId: z.number().describe("Sonarr series ID")},
    async ({seriesId}) => {
      const result = await api(`/series/${seriesId}`);
      return {content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
    }
  );

  server.tool(
    "sonarr_add_series",
    "Add a new TV series to Sonarr for monitoring and downloading.",
    {
      tvdbId: z.number().describe("TVDB ID of the series (get from sonarr_search)"),
      qualityProfileId: z.number().default(1).describe("Quality profile ID (default: 1)"),
      rootFolderPath: z.string().describe("Root folder path for the series (e.g. /tv)"),
      monitored: z.boolean().default(true).describe("Whether to monitor for new episodes"),
      searchForMissingEpisodes: z
        .boolean()
        .default(true)
        .describe("Search for existing episodes immediately"),
    },
    async ({tvdbId, qualityProfileId, rootFolderPath, monitored, searchForMissingEpisodes}) => {
      const lookup = (await api("/series/lookup", {
        params: {term: `tvdb:${tvdbId}`},
      })) as Array<Record<string, unknown>>;

      if (!lookup.length) {
        return {content: [{type: "text", text: "Series not found with that TVDB ID."}]};
      }

      const seriesData = {
        ...lookup[0],
        qualityProfileId,
        rootFolderPath,
        monitored,
        addOptions: {searchForMissingEpisodes},
      };

      const result = await api("/series", {method: "POST", body: seriesData});
      return {content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
    }
  );

  server.tool(
    "sonarr_calendar",
    "Get upcoming episodes from Sonarr's calendar.",
    {
      start: z.string().optional().describe("Start date (ISO 8601). Defaults to today."),
      end: z.string().optional().describe("End date (ISO 8601). Defaults to 7 days from start."),
    },
    async ({start, end}) => {
      const params: Record<string, string> = {};
      if (start) {
        params.start = start;
      }
      if (end) {
        params.end = end;
      }
      const results = await api("/calendar", {params});
      const episodes = (results as Array<Record<string, unknown>>).map((e) => ({
        seriesTitle: (e.series as Record<string, unknown>)?.title,
        seasonNumber: e.seasonNumber,
        episodeNumber: e.episodeNumber,
        title: e.title,
        airDateUtc: e.airDateUtc,
        hasFile: e.hasFile,
        monitored: e.monitored,
      }));
      return {content: [{type: "text", text: JSON.stringify(episodes, null, 2)}]};
    }
  );

  server.tool("sonarr_queue", "Get the current download queue from Sonarr.", {}, async () => {
    const result = (await api("/queue", {
      params: {pageSize: "50", includeUnknownSeriesItems: "true"},
    })) as Record<string, unknown>;
    const records = (result.records as Array<Record<string, unknown>> | undefined) ?? [];
    const queue = records.map((q) => ({
      id: q.id,
      title: q.title,
      status: q.status,
      size: q.size,
      sizeleft: q.sizeleft,
      timeleft: q.timeleft,
      estimatedCompletionTime: q.estimatedCompletionTime,
      downloadClient: q.downloadClient,
      indexer: q.indexer,
      trackedDownloadStatus: q.trackedDownloadStatus,
      trackedDownloadState: q.trackedDownloadState,
      statusMessages: q.statusMessages,
      errorMessage: q.errorMessage,
    }));
    return {content: [{type: "text", text: JSON.stringify(queue, null, 2)}]};
  });

  server.tool(
    "sonarr_queue_details",
    "Get detailed info about a specific queue item, including status messages and error reasons.",
    {queueId: z.number().describe("Queue item ID (get from sonarr_queue)")},
    async ({queueId}) => {
      const result = (await api("/queue", {
        params: {pageSize: "100", includeUnknownSeriesItems: "true"},
      })) as Record<string, unknown>;
      const records = (result.records as Array<Record<string, unknown>> | undefined) ?? [];
      const item = records.find((q) => q.id === queueId);
      if (!item) {
        return {content: [{type: "text", text: `Queue item ${queueId} not found.`}]};
      }
      return {content: [{type: "text", text: JSON.stringify(item, null, 2)}]};
    }
  );

  server.tool(
    "sonarr_episode_search",
    "Trigger a manual search for a specific episode or all episodes in a season.",
    {
      seriesId: z.number().describe("Sonarr series ID"),
      seasonNumber: z.number().optional().describe("Season number (omit to search all)"),
      episodeIds: z.array(z.number()).optional().describe("Specific episode IDs to search for"),
    },
    async ({seriesId, seasonNumber, episodeIds}) => {
      if (episodeIds?.length) {
        const result = await api("/command", {
          method: "POST",
          body: {name: "EpisodeSearch", episodeIds},
        });
        return {content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
      }

      if (seasonNumber !== undefined) {
        const result = await api("/command", {
          method: "POST",
          body: {name: "SeasonSearch", seriesId, seasonNumber},
        });
        return {content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
      }

      const result = await api("/command", {
        method: "POST",
        body: {name: "SeriesSearch", seriesId},
      });
      return {content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
    }
  );

  server.tool(
    "sonarr_manual_search",
    "Get a list of available releases for an episode so you can pick one manually. Returns numbered options with quality, size, indexer, and seeders.",
    {episodeId: z.number().describe("Episode ID to search releases for")},
    async ({episodeId}) => {
      const results = await api("/release", {params: {episodeId: String(episodeId)}});
      const releases = (results as Array<Record<string, unknown>>).map((r, i) => ({
        "#": i + 1,
        guid: r.guid,
        title: r.title,
        quality: (r.quality as Record<string, unknown>)?.quality
          ? ((r.quality as Record<string, unknown>).quality as Record<string, unknown>)?.name
          : r.quality,
        size: `${(((r.size as number) ?? 0) / 1024 / 1024 / 1024).toFixed(2)} GB`,
        indexer: r.indexer,
        seeders: r.seeders,
        leechers: r.leechers,
        age: `${r.ageMinutes ? Math.round((r.ageMinutes as number) / 60 / 24) : "?"} days`,
        rejected: !!(r.rejections as unknown[])?.length,
        rejectionReasons: (r.rejections as string[] | undefined) ?? [],
        downloadAllowed: r.downloadAllowed,
        indexerId: r.indexerId,
        protocol: r.protocol,
      }));
      if (!releases.length) {
        return {content: [{type: "text", text: "No releases found for this episode."}]};
      }
      const header = `Found ${releases.length} releases. Use sonarr_grab_release with the guid to download one.\n\n`;
      return {content: [{type: "text", text: header + JSON.stringify(releases, null, 2)}]};
    }
  );

  server.tool(
    "sonarr_grab_release",
    "Grab (download) a specific release from a manual search.",
    {
      guid: z.string().describe("Release GUID from sonarr_manual_search"),
      indexerId: z.number().describe("Indexer ID from sonarr_manual_search"),
    },
    async ({guid, indexerId}) => {
      const result = await api("/release", {
        method: "POST",
        body: {guid, indexerId},
      });
      return {
        content: [{type: "text", text: `Release grabbed.\n${JSON.stringify(result, null, 2)}`}],
      };
    }
  );

  server.tool(
    "sonarr_history",
    "Get download history for a series or episode. Shows what was grabbed, imported, failed, and why.",
    {
      seriesId: z.number().optional().describe("Filter by series ID"),
      episodeId: z.number().optional().describe("Filter by episode ID"),
      limit: z.number().default(20).describe("Number of history entries (default: 20)"),
      eventType: z
        .enum([
          "grabbed",
          "downloadFolderImported",
          "downloadFailed",
          "episodeFileDeleted",
          "episodeFileRenamed",
        ])
        .optional()
        .describe("Filter by event type"),
    },
    async ({seriesId, episodeId, limit, eventType}) => {
      const params: Record<string, string> = {
        pageSize: String(limit),
        sortKey: "date",
        sortDirection: "descending",
      };
      if (seriesId) {
        params.seriesId = String(seriesId);
      }
      if (episodeId) {
        params.episodeId = String(episodeId);
      }
      if (eventType) {
        params.eventType = eventType;
      }
      const result = (await api("/history", {params})) as Record<string, unknown>;
      const records = (result.records as Array<Record<string, unknown>> | undefined) ?? [];
      const history = records.map((h) => {
        const data = (h.data as Record<string, unknown>) ?? {};
        return {
          id: h.id,
          eventType: h.eventType,
          date: h.date,
          sourceTitle: h.sourceTitle,
          quality: (h.quality as Record<string, unknown>)?.quality
            ? ((h.quality as Record<string, unknown>).quality as Record<string, unknown>)?.name
            : null,
          seriesTitle: (h.series as Record<string, unknown>)?.title,
          episodeTitle: (h.episode as Record<string, unknown>)?.title,
          seasonNumber: (h.episode as Record<string, unknown>)?.seasonNumber,
          episodeNumber: (h.episode as Record<string, unknown>)?.episodeNumber,
          // Diagnostic fields — why things failed or succeeded
          downloadClient: data.downloadClient ?? null,
          indexer: data.indexer ?? null,
          message: data.message ?? null,
          reason: data.reason ?? null,
          droppedPath: data.droppedPath ?? null,
          importedPath: data.importedPath ?? null,
        };
      });
      return {content: [{type: "text", text: JSON.stringify(history, null, 2)}]};
    }
  );

  server.tool(
    "sonarr_blocklist",
    "Get blocked releases — releases that Sonarr tried to download but failed and won't retry.",
    {limit: z.number().default(20).describe("Number of entries (default: 20)")},
    async ({limit}) => {
      const result = (await api("/blocklist", {
        params: {pageSize: String(limit), sortKey: "date", sortDirection: "descending"},
      })) as Record<string, unknown>;
      const records = (result.records as Array<Record<string, unknown>> | undefined) ?? [];
      const items = records.map((b) => ({
        id: b.id,
        seriesId: b.seriesId,
        sourceTitle: b.sourceTitle,
        date: b.date,
        quality: (b.quality as Record<string, unknown>)?.quality
          ? ((b.quality as Record<string, unknown>).quality as Record<string, unknown>)?.name
          : null,
        message: b.message,
        indexer: (b.data as Record<string, unknown>)?.indexer ?? null,
      }));
      return {content: [{type: "text", text: JSON.stringify(items, null, 2)}]};
    }
  );

  server.tool(
    "sonarr_get_quality_profiles",
    "List available quality profiles in Sonarr.",
    {},
    async () => {
      const results = await api("/qualityprofile");
      const profiles = (results as Array<Record<string, unknown>>).map((p) => ({
        id: p.id,
        name: p.name,
      }));
      return {content: [{type: "text", text: JSON.stringify(profiles, null, 2)}]};
    }
  );

  server.tool(
    "sonarr_get_root_folders",
    "List configured root folders in Sonarr.",
    {},
    async () => {
      const results = await api("/rootfolder");
      const folders = (results as Array<Record<string, unknown>>).map((f) => ({
        id: f.id,
        path: f.path,
        freeSpace: f.freeSpace,
      }));
      return {content: [{type: "text", text: JSON.stringify(folders, null, 2)}]};
    }
  );

  server.tool(
    "sonarr_delete_series",
    "Delete a series from Sonarr.",
    {
      seriesId: z.number().describe("Sonarr series ID to delete"),
      deleteFiles: z.boolean().default(false).describe("Also delete files from disk"),
    },
    async ({seriesId, deleteFiles}) => {
      await api(`/series/${seriesId}`, {
        method: "DELETE",
        params: {deleteFiles: String(deleteFiles)},
      });
      return {content: [{type: "text", text: `Series ${seriesId} deleted.`}]};
    }
  );
};
