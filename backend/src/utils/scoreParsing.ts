/**
 * Shared score parsing utilities for 90FM Trivia score pages.
 * Handles multiple HTML formats across decades of score pages.
 */

import * as cheerio from "cheerio";

export interface ParsedScore {
  place: number;
  teamName: string;
  score: number;
}

const WORD_TO_NUM: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
};

const wordsToNumber = (text: string): number => {
  const words = text
    .toLowerCase()
    .trim()
    .split(/[\s-]+/);
  let total = 0;
  for (const w of words) {
    if (WORD_TO_NUM[w] !== undefined) {
      total += WORD_TO_NUM[w];
    }
  }
  return total;
};

/**
 * Extract hour number from a page title string.
 * Handles: "Hour 23", "Hr 23", "H23", "after hour 23", "Hour Fifty Four".
 */
export const extractHour = (title: string): number => {
  const hourMatch = title.match(/(?:hour|hr)\.?\s*(\d+)/i);
  if (hourMatch) {
    return Number.parseInt(hourMatch[1], 10);
  }

  const hourWordsMatch = title.match(/(?:hour|hr)\.?\s+([a-z][\w\s-]+)/i);
  if (hourWordsMatch) {
    const num = wordsToNumber(hourWordsMatch[1]);
    if (num > 0) {
      return num;
    }
  }

  const afterMatch = title.match(/after\s+(\d+)/i);
  if (afterMatch) {
    return Number.parseInt(afterMatch[1], 10);
  }

  const hMatch = title.match(/\bH(\d+)\b/);
  if (hMatch) {
    return Number.parseInt(hMatch[1], 10);
  }

  return 0;
};

/**
 * Extract year from a page title string.
 */
export const extractYear = (title: string): number => {
  const yearMatch = title.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    return Number.parseInt(yearMatch[0], 10);
  }
  return 0;
};

/**
 * Convert HTML to text with line breaks at block boundaries.
 * Cheerio's .text() concatenates without breaks — we need newlines
 * between <p>, <br>, <tr>, <div>, etc.
 */
export const htmlToText = ($: cheerio.CheerioAPI, selector: string): string => {
  const el = $(selector);
  el.find("p, br, tr, div, li, h1, h2, h3, h4, h5, h6").each((_i, node) => {
    $(node).before("\n");
  });
  return el.text();
};

/**
 * Resolve iframe src to a full URL relative to the parent page.
 */
export const resolveIframeUrl = ($: cheerio.CheerioAPI, parentUrl: string): string | null => {
  const iframeSrc = $("iframe").first().attr("src");
  if (!iframeSrc) {
    return null;
  }
  if (iframeSrc.startsWith("http")) {
    return iframeSrc;
  }
  const base = parentUrl.endsWith("/") ? parentUrl : parentUrl.replace(/[^/]*$/, "");
  return new URL(iframeSrc, base).href;
};

/**
 * Parse scores from structured <dl>/<dt>/<dd> with span.place-number and span.score.
 * Used by 2011+ pages.
 */
export const parseScoresFromDl = ($: cheerio.CheerioAPI): ParsedScore[] => {
  const scores: ParsedScore[] = [];
  const placeSpans = $("span.place-number");

  if (placeSpans.length === 0) {
    return scores;
  }

  $("dt").each((_i, dt) => {
    const placeText = $(dt).find("span.place-number").text().trim();
    const scoreText = $(dt).find("span.score").text().trim();

    if (!placeText || !scoreText) {
      return;
    }

    const place = Number.parseInt(placeText.replace(/(?:st|nd|rd|th)$/i, ""), 10);
    const score = Number.parseInt(scoreText.replace(/,/g, ""), 10);

    if (Number.isNaN(place) || Number.isNaN(score)) {
      return;
    }

    const dd = $(dt).next("dd");
    dd.find("p").each((_j, p) => {
      const teamName = $(p)
        .text()
        .replace(/\u00a0/g, " ")
        .trim();
      if (teamName) {
        scores.push({place, score, teamName});
      }
    });
  });

  return scores;
};

/**
 * Parse scores from an HTML table.
 */
export const parseScoresFromTable = ($: cheerio.CheerioAPI): ParsedScore[] => {
  const scores: ParsedScore[] = [];

  $("table tr").each((_i, row) => {
    const cells = $(row).find("td, th");
    if (cells.length < 2) {
      return;
    }

    const cellTexts = cells.map((_j, cell) => $(cell).text().trim()).get();

    const numericCells = cellTexts.map((t) => {
      const cleaned = t.replace(/[,#]/g, "").replace(/(?:st|nd|rd|th)$/i, "");
      return /^\d+$/.test(cleaned) ? Number.parseInt(cleaned, 10) : null;
    });

    const firstNumIdx = numericCells.findIndex((n) => n !== null);
    const lastNumIdx =
      numericCells.length - 1 - [...numericCells].reverse().findIndex((n) => n !== null);

    if (firstNumIdx === -1 || firstNumIdx === lastNumIdx) {
      return;
    }

    const place = numericCells[firstNumIdx]!;
    const score = numericCells[lastNumIdx]!;
    const teamParts = cellTexts.filter(
      (_t, idx) => idx !== firstNumIdx && idx !== lastNumIdx && numericCells[idx] === null
    );
    const teamName = teamParts.join(" ").trim();

    if (teamName && place > 0 && score >= 0) {
      scores.push({place, score, teamName});
    }
  });

  return scores;
};

/**
 * Parse scores from plaintext format.
 * Handles formats like:
 *   "526th place 280 points THE CLAYTON AVENUE TROOPS"
 *   "#1___11005pts.___CNOF54: RUNNIN' OUTTA TIME"
 *   "1. 11005 CNOF54: RUNNIN' OUTTA TIME"
 */
export const parseScoresFromText = (text: string): ParsedScore[] => {
  const scores: ParsedScore[] = [];
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const line of lines) {
    let match: RegExpMatchArray | null;

    // Format: "526th place 280 points TEAM NAME"
    match = line.match(/^(\d+)(?:st|nd|rd|th)\s+place\s+([\d,]+)\s+points?\s+(.+)$/i);
    if (match) {
      scores.push({
        place: Number.parseInt(match[1], 10),
        score: Number.parseInt(match[2].replace(/,/g, ""), 10),
        teamName: match[3].trim(),
      });
      continue;
    }

    // Format: "#1___11005pts.___TEAM NAME" (underscores or whitespace as separators)
    match = line.match(/^#(\d+)[_\s]+([\d,]+)\s*pts?\.?[_\s]+(.+)$/i);
    if (match) {
      scores.push({
        place: Number.parseInt(match[1], 10),
        score: Number.parseInt(match[2].replace(/,/g, ""), 10),
        teamName: match[3].trim(),
      });
      continue;
    }

    // Format: "1. 11005 TEAM NAME" or "1) 11005 TEAM NAME"
    match = line.match(/^(\d+)[.)]\s+([\d,]+)\s+(.+)$/);
    if (match) {
      scores.push({
        place: Number.parseInt(match[1], 10),
        score: Number.parseInt(match[2].replace(/,/g, ""), 10),
        teamName: match[3].trim(),
      });
      continue;
    }

    // Format: "1  TEAM NAME  11005" (place, team, score with tabs/spaces)
    match = line.match(/^(\d+)\s{2,}(.+?)\s{2,}([\d,]+)\s*$/);
    if (match) {
      scores.push({
        place: Number.parseInt(match[1], 10),
        score: Number.parseInt(match[3].replace(/,/g, ""), 10),
        teamName: match[2].trim(),
      });
    }
  }

  return scores;
};

/**
 * Try all parsing strategies on a cheerio-loaded page. Returns scores and extracted hour.
 */
export const parsePage = ($: cheerio.CheerioAPI): {hour: number; scores: ParsedScore[]} => {
  // Combine <title>, <h1>, and <h2> — some score pages put the hour only in the h1
  // (e.g. 2026 pages: <title>TRIVIA 56: Team Standings</title> / <h1>... as of Hour Twelve</h1>).
  const titleSources = [$("title").text(), $("h1").first().text(), $("h2").first().text(), $("h3").first().text()]
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const title = titleSources.join(" | ");
  let hour = extractHour(title);
  if (hour === 0) {
    for (const source of titleSources) {
      const h = extractHour(source);
      if (h > 0) {
        hour = h;
        break;
      }
    }
  }

  let scores = parseScoresFromDl($);

  if (scores.length === 0) {
    scores = parseScoresFromTable($);
  }

  if (scores.length === 0) {
    const bodyText = htmlToText($, "body");
    scores = parseScoresFromText(bodyText);
  }

  if (scores.length === 0) {
    const preText = $("pre, code").text();
    if (preText) {
      scores = parseScoresFromText(preText);
    }
  }

  scores.sort((a, b) => a.place - b.place);

  return {hour, scores};
};

/**
 * Fetch a page with timeout. Returns null on error or PHP error pages.
 */
export const fetchPage = async (
  url: string
): Promise<{$: cheerio.CheerioAPI; html: string} | null> => {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      console.warn(`  HTTP ${response.status} for ${url}`);
      return null;
    }
    const html = await response.text();

    if (html.includes("Fatal error") && html.includes("Call to a member function")) {
      console.warn(`  PHP error page, skipping: ${url}`);
      return null;
    }

    return {$: cheerio.load(html), html};
  } catch (err) {
    console.warn(`  Fetch error for ${url}:`, err);
    return null;
  }
};
