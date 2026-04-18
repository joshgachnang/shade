/**
 * Tavily Search API client.
 *
 * API key resolution order:
 *   1. TAVILY_API_KEY env var
 *   2. AppConfig.apiKeys.tavily (from MongoDB)
 */

import {loadAppConfig} from "../../models/appConfig";
import type {SearchOptions, SearchResult} from "./types";

const TAVILY_API_URL = "https://api.tavily.com/search";

const FRESHNESS_MAP: Record<string, string> = {
  day: "day",
  week: "week",
  month: "month",
  year: "year",
};

const getApiKey = async (): Promise<string | null> => {
  if (process.env.TAVILY_API_KEY) {
    return process.env.TAVILY_API_KEY;
  }

  try {
    const config = await loadAppConfig();
    if (config.apiKeys?.tavily) {
      return config.apiKeys.tavily;
    }
  } catch {
    // AppConfig may not be available
  }

  return null;
};

export const tavilySearch = async (
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> => {
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.warn("Tavily API key not set, skipping");
    return [];
  }

  const body: Record<string, any> = {
    query,
    max_results: options.count || 5,
    include_answer: false,
  };

  if (options.freshness) {
    body.time_range = FRESHNESS_MAP[options.freshness] || options.freshness;
  }

  const response = await fetch(TAVILY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    console.warn(`Tavily search failed: ${response.status} ${await response.text()}`);
    return [];
  }

  const data = (await response.json()) as {results?: any[]};
  const results = data.results || [];

  return results.map((r: any) => ({
    title: r.title || "",
    url: r.url || "",
    description: r.content || "",
    source: "tavily" as const,
  }));
};
