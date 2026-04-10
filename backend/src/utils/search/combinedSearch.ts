/**
 * Combined search that queries all available providers in parallel
 * and deduplicates results by URL.
 */

import {braveSearch} from "./brave";
import {exaSearch} from "./exa";
import {tavilySearch} from "./tavily";
import type {SearchOptions, SearchResult} from "./types";

/**
 * Deduplicate results by URL, keeping the first occurrence.
 * URLs are normalized by stripping trailing slashes and lowercasing the hostname.
 */
const deduplicateResults = (results: SearchResult[]): SearchResult[] => {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const result of results) {
    let normalized: string;
    try {
      const parsed = new URL(result.url);
      parsed.hostname = parsed.hostname.toLowerCase();
      // Remove trailing slash for consistency
      normalized = parsed.toString().replace(/\/$/, "");
    } catch {
      normalized = result.url;
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      deduped.push(result);
    }
  }

  return deduped;
};

/**
 * Search all providers in parallel and return deduplicated results.
 * Providers that fail or have no API key configured are silently skipped.
 */
export const combinedSearch = async (
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> => {
  const [braveResults, exaResults, tavilyResults] = await Promise.all([
    braveSearch(query, options).catch((err) => {
      console.warn("Brave search error:", err);
      return [] as SearchResult[];
    }),
    exaSearch(query, options).catch((err) => {
      console.warn("Exa search error:", err);
      return [] as SearchResult[];
    }),
    tavilySearch(query, options).catch((err) => {
      console.warn("Tavily search error:", err);
      return [] as SearchResult[];
    }),
  ]);

  const allResults = [...braveResults, ...exaResults, ...tavilyResults];
  return deduplicateResults(allResults);
};
