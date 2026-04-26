import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {makeRequest} from "../apiClient";
import type {ServiceConfig} from "../config";

export const registerRadarrTools = (server: McpServer, config: ServiceConfig) => {
  const api = (path: string, options?: Parameters<typeof makeRequest>[3]) =>
    makeRequest(config.baseUrl, `/api/v3${path}`, config.apiKey, options);

  server.tool(
    "radarr_search",
    "Search for movies by name. Returns numbered results you can reference when adding.",
    {term: z.string().describe("Search term (e.g. 'The Matrix')")},
    async ({term}) => {
      const results = await api("/movie/lookup", {params: {term}});
      const movies = (results as Array<Record<string, unknown>>).slice(0, 15).map((m, i) => ({
        "#": i + 1,
        title: m.title,
        year: m.year,
        tmdbId: m.tmdbId,
        imdbId: m.imdbId,
        overview: typeof m.overview === "string" ? m.overview.slice(0, 300) : "",
        runtime: m.runtime,
        status: m.status,
        isAvailable: m.isAvailable,
        genres: (m.genres as string[] | undefined)?.join(", ") ?? "",
        ratings:
          (m.ratings as Record<string, unknown>)?.imdb ??
          (m.ratings as Record<string, unknown>)?.value ??
          null,
        studio: m.studio,
      }));
      if (!movies.length) {
        return {content: [{type: "text", text: `No results found for "${term}".`}]};
      }
      const header = `Found ${movies.length} results for "${term}". Use the tmdbId to add a movie.\n\n`;
      return {content: [{type: "text", text: header + JSON.stringify(movies, null, 2)}]};
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
      trackedDownloadStatus: q.trackedDownloadStatus,
      trackedDownloadState: q.trackedDownloadState,
      statusMessages: q.statusMessages,
      errorMessage: q.errorMessage,
    }));
    return {content: [{type: "text", text: JSON.stringify(queue, null, 2)}]};
  });

  server.tool(
    "radarr_queue_details",
    "Get detailed info about a specific queue item, including status messages and error reasons.",
    {queueId: z.number().describe("Queue item ID (get from radarr_queue)")},
    async ({queueId}) => {
      const result = (await api("/queue", {
        params: {pageSize: "100", includeUnknownMovieItems: "true"},
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
    "radarr_manual_search",
    "Get a list of available releases for a movie so you can pick one manually. Returns numbered options with quality, size, indexer, and seeders.",
    {movieId: z.number().describe("Movie ID to search releases for")},
    async ({movieId}) => {
      const results = await api("/release", {params: {movieId: String(movieId)}});
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
        return {content: [{type: "text", text: "No releases found for this movie."}]};
      }
      const header = `Found ${releases.length} releases. Use radarr_grab_release with the guid to download one.\n\n`;
      return {content: [{type: "text", text: header + JSON.stringify(releases, null, 2)}]};
    }
  );

  server.tool(
    "radarr_grab_release",
    "Grab (download) a specific release from a manual search.",
    {
      guid: z.string().describe("Release GUID from radarr_manual_search"),
      indexerId: z.number().describe("Indexer ID from radarr_manual_search"),
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
    "radarr_history",
    "Get download history for a movie. Shows what was grabbed, imported, failed, and why.",
    {
      movieId: z.number().optional().describe("Filter by movie ID"),
      limit: z.number().default(20).describe("Number of history entries (default: 20)"),
      eventType: z
        .enum([
          "grabbed",
          "downloadFolderImported",
          "downloadFailed",
          "movieFileDeleted",
          "movieFileRenamed",
        ])
        .optional()
        .describe("Filter by event type"),
    },
    async ({movieId, limit, eventType}) => {
      const params: Record<string, string> = {
        pageSize: String(limit),
        sortKey: "date",
        sortDirection: "descending",
      };
      if (movieId) {
        params.movieId = String(movieId);
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
          movieTitle: (h.movie as Record<string, unknown>)?.title,
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
    "radarr_blocklist",
    "Get blocked releases — releases that Radarr tried to download but failed and won't retry.",
    {limit: z.number().default(20).describe("Number of entries (default: 20)")},
    async ({limit}) => {
      const result = (await api("/blocklist", {
        params: {pageSize: String(limit), sortKey: "date", sortDirection: "descending"},
      })) as Record<string, unknown>;
      const records = (result.records as Array<Record<string, unknown>> | undefined) ?? [];
      const items = records.map((b) => ({
        id: b.id,
        movieId: b.movieId,
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
