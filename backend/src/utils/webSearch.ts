/**
 * Brave Search API client for general-purpose web search.
 *
 * API key resolution order:
 *   1. BRAVE_SEARCH_API_KEY env var
 *   2. AppConfig.apiKeys.braveSearch (from MongoDB)
 *
 * Usage:
 *   import {braveSearch} from "../utils/webSearch";
 *   const results = await braveSearch("who played Sundance Kid", {count: 5});
 */

import {loadAppConfig} from "../models/appConfig";

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";

export interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
}

export interface BraveSearchOptions {
  count?: number;
  freshness?: "pd" | "pw" | "pm" | "py"; // past day/week/month/year
}

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
    // AppConfig may not be available (e.g., in standalone scripts without main DB)
  }

  return null;
};

export const braveSearch = async (
  query: string,
  options: BraveSearchOptions = {}
): Promise<BraveSearchResult[]> => {
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.warn("BRAVE_SEARCH_API_KEY not set (env or AppConfig), skipping web search");
    return [];
  }

  const params = new URLSearchParams({
    q: query,
    count: String(options.count || 5),
  });
  if (options.freshness) {
    params.set("freshness", options.freshness);
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
  }));
};

/**
 * Format search results into a text block suitable for LLM context.
 */
export const formatSearchResults = (results: BraveSearchResult[]): string => {
  if (results.length === 0) {
    return "No search results found.";
  }
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.description}`)
    .join("\n\n");
};
