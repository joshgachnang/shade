/**
 * Shared types for all search providers.
 */

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  source: "brave" | "exa" | "tavily";
}

export interface SearchOptions {
  count?: number;
  freshness?: "day" | "week" | "month" | "year";
}

export type SearchProvider = (query: string, options?: SearchOptions) => Promise<SearchResult[]>;

/**
 * Format search results into a text block suitable for LLM context.
 */
export const formatSearchResults = (results: SearchResult[]): string => {
  if (results.length === 0) {
    return "No search results found.";
  }
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.description}`)
    .join("\n\n");
};
