import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {makeRequest} from "../apiClient";
import type {ServiceConfig} from "../config";

export const registerRadarrTools = (server: McpServer, config: ServiceConfig) => {
  const api = (path: string, options?: Parameters<typeof makeRequest>[3]) =>
    makeRequest(config.baseUrl, `/api/v3${path}`, config.apiKey, options);

  server.tool(
    "radarr_search",
    "Search for movies by name on Radarr. Returns matching results from TMDB.",
    {term: z.string().describe("Search term (e.g. 'The Matrix')")},
    async ({term}) => {
      const results = await api("/movie/lookup", {params: {term}});
      const movies = (results as Array<Record<string, unknown>>).slice(0, 10).map((m) => ({
        title: m.title,
        year: m.year,
        tmdbId: m.tmdbId,
        imdbId: m.imdbId,
        overview: typeof m.overview === "string" ? m.overview.slice(0, 200) : "",
        runtime: m.runtime,
        status: m.status,
        isAvailable: m.isAvailable,
      }));
      return {content: [{type: "text", text: JSON.stringify(movies, null, 2)}]};
    }
  );

  server.tool(
    "radarr_list_movies",
    "List all movies currently in Radarr's library.",
    {},
    async () => {
      const results = await api("/movie");
      const movies = (results as Array<Record<string, unknown>>).map((m) => ({
        id: m.id,
        title: m.title,
        year: m.year,
        status: m.status,
        monitored: m.monitored,
        hasFile: m.hasFile,
        sizeOnDisk: m.sizeOnDisk,
        qualityProfileId: m.qualityProfileId,
      }));
      return {content: [{type: "text", text: JSON.stringify(movies, null, 2)}]};
    }
  );

  server.tool(
    "radarr_get_movie",
    "Get detailed information about a specific movie in Radarr by its ID.",
    {movieId: z.number().describe("Radarr movie ID")},
    async ({movieId}) => {
      const result = await api(`/movie/${movieId}`);
      return {content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
    }
  );

  server.tool(
    "radarr_add_movie",
    "Add a new movie to Radarr for monitoring and downloading.",
    {
      tmdbId: z.number().describe("TMDB ID of the movie (get from radarr_search)"),
      qualityProfileId: z.number().default(1).describe("Quality profile ID (default: 1)"),
      rootFolderPath: z.string().describe("Root folder path for movies (e.g. /movies)"),
      monitored: z.boolean().default(true).describe("Whether to monitor for availability"),
      searchForMovie: z.boolean().default(true).describe("Search for the movie immediately"),
    },
    async ({tmdbId, qualityProfileId, rootFolderPath, monitored, searchForMovie}) => {
      const lookup = (await api("/movie/lookup", {
        params: {term: `tmdb:${tmdbId}`},
      })) as Array<Record<string, unknown>>;

      if (!lookup.length) {
        return {content: [{type: "text", text: "Movie not found with that TMDB ID."}]};
      }

      const movieData = {
        ...lookup[0],
        qualityProfileId,
        rootFolderPath,
        monitored,
        addOptions: {searchForMovie},
      };

      const result = await api("/movie", {method: "POST", body: movieData});
      return {content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
    }
  );

  server.tool(
    "radarr_calendar",
    "Get upcoming movies from Radarr's calendar (physical/digital releases).",
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
      const movies = (results as Array<Record<string, unknown>>).map((m) => ({
        title: m.title,
        year: m.year,
        physicalRelease: m.physicalRelease,
        digitalRelease: m.digitalRelease,
        inCinemas: m.inCinemas,
        hasFile: m.hasFile,
        monitored: m.monitored,
      }));
      return {content: [{type: "text", text: JSON.stringify(movies, null, 2)}]};
    }
  );

  server.tool("radarr_queue", "Get the current download queue from Radarr.", {}, async () => {
    const result = (await api("/queue", {
      params: {pageSize: "50", includeUnknownMovieItems: "true"},
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
    "radarr_movie_search",
    "Trigger a manual search for a specific movie in Radarr.",
    {movieIds: z.array(z.number()).describe("Movie IDs to search for")},
    async ({movieIds}) => {
      const result = await api("/command", {
        method: "POST",
        body: {name: "MoviesSearch", movieIds},
      });
      return {content: [{type: "text", text: JSON.stringify(result, null, 2)}]};
    }
  );

  server.tool(
    "radarr_get_quality_profiles",
    "List available quality profiles in Radarr.",
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
    "radarr_get_root_folders",
    "List configured root folders in Radarr.",
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
    "radarr_delete_movie",
    "Delete a movie from Radarr.",
    {
      movieId: z.number().describe("Radarr movie ID to delete"),
      deleteFiles: z.boolean().default(false).describe("Also delete files from disk"),
    },
    async ({movieId, deleteFiles}) => {
      await api(`/movie/${movieId}`, {
        method: "DELETE",
        params: {deleteFiles: String(deleteFiles)},
      });
      return {content: [{type: "text", text: `Movie ${movieId} deleted.`}]};
    }
  );
};
