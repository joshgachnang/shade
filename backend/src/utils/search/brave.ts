/**
 * Brave Search API client.
 *
 * API key resolution order:
 *   1. BRAVE_SEARCH_API_KEY env var
 *   2. AppConfig.apiKeys.braveSearch (from MongoDB)
 */

import {loadAppConfig} from "../../models/appConfig";
import type {SearchOptions, SearchResult} from "./types";

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";

const FRESHNESS_MAP: Record<string, string> = {
  day: "pd",
  week: "pw",
  month: "pm",
  year: "py",
};

const getApiKey = async (): Promise<string | null> => {
  if (process.env.BRAVE_SEARCH_API_KEY) {
    return process.env.BRAVE_SEARCH_API_KEY;
  }

  try {
    const config = await loadAppConfig();
    if (config.apiKeys?.braveSearch) {
      return config.apiKeys.braveSearch;
    }
  } catch {
    // AppConfig may not be available
  }

  return null;
};

export const braveSearch = async (
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> => {
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.warn("Brave Search API key not set, skipping");
    return [];
  }

  const params = new URLSearchParams({
    q: query,
    count: String(options.count || 5),
  });
  if (options.freshness) {
    params.set("freshness", FRESHNESS_MAP[options.freshness] || options.freshness);
  }

  const response = await fetch(`${BRAVE_API_URL}?${params}`, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    console.warn(`Brave search failed: ${response.status} ${await response.text()}`);
    return [];
  }

  const data = (await response.json()) as {web?: {results?: any[]}};
  const webResults = data.web?.results || [];

  return webResults.map((r: any) => ({
    title: r.title || "",
    url: r.url || "",
    description: r.description || "",
    source: "brave" as const,
  }));
};
