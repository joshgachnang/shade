import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {makeRequest} from "../apiClient";
import type {ServiceConfig} from "../config";

export const registerSonarrTools = (server: McpServer, config: ServiceConfig) => {
  const api = (path: string, options?: Parameters<typeof makeRequest>[3]) =>
    makeRequest(config.baseUrl, `/api/v3${path}`, config.apiKey, options);

  server.tool(
    "sonarr_search",
    "Search for TV series by name on Sonarr. Returns matching results from TheTVDB/TMDB.",
    {term: z.string().describe("Search term (e.g. 'Breaking Bad')")},
    async ({term}) => {
      const results = await api("/series/lookup", {params: {term}});
      const series = (results as Array<Record<string, unknown>>).slice(0, 10).map((s) => ({
        title: s.title,
        year: s.year,
        tvdbId: s.tvdbId,
        imdbId: s.imdbId,
        overview: typeof s.overview === "string" ? s.overview.slice(0, 200) : "",
        seasonCount: s.seasonCount,
        status: s.status,
      }));
      return {content: [{type: "text", text: JSON.stringify(series, null, 2)}]};
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
      // Lookup the series first to get full details
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
    }));
    return {content: [{type: "text", text: JSON.stringify(queue, null, 2)}]};
  });

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
