/**
 * Exa Search API client.
 *
 * API key resolution order:
 *   1. EXA_API_KEY env var
 *   2. AppConfig.apiKeys.exa (from MongoDB)
 */

import {loadAppConfig} from "../../models/appConfig";
import type {SearchOptions, SearchResult} from "./types";

const EXA_API_URL = "https://api.exa.ai/search";

const getApiKey = async (): Promise<string | null> => {
  if (process.env.EXA_API_KEY) {
    return process.env.EXA_API_KEY;
  }

  try {
    const config = await loadAppConfig();
    if (config.apiKeys?.exa) {
      return config.apiKeys.exa;
    }
  } catch {
    // AppConfig may not be available
  }

  return null;
};

export const exaSearch = async (
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> => {
  const apiKey = await getApiKey();
  if (!apiKey) {
    console.warn("Exa API key not set, skipping");
    return [];
  }

  const body: Record<string, any> = {
    query,
    numResults: options.count || 5,
    type: "neural",
    contents: {
      text: {maxCharacters: 500},
    },
  };

  if (options.freshness) {
    const now = new Date();
    const offsets: Record<string, number> = {
      day: 1,
      week: 7,
      month: 30,
      year: 365,
    };
    const days = offsets[options.freshness] || 7;
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    body.startPublishedDate = startDate.toISOString();
  }

  const response = await fetch(EXA_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    console.warn(`Exa search failed: ${response.status} ${await response.text()}`);
    return [];
  }

  const data = (await response.json()) as {results?: any[]};
  const results = data.results || [];

  return results.map((r: any) => ({
    title: r.title || "",
    url: r.url || "",
    description: r.text || r.snippet || "",
    source: "exa" as const,
  }));
};
