/**
 * Scrape live trivia scores from 90fmtrivia.org during the contest.
 *
 * Usage:
 *   bun run scripts/scrapeScores.ts              # Scrape once
 *   bun run scripts/scrapeScores.ts --loop        # Scrape every 5 minutes during contest hours
 *   bun run scripts/scrapeScores.ts --url <url>   # Override scores URL
 *
 * Contest hours for 2026: April 17 6PM CT — April 20 5PM CT
 */

import {join} from "node:path";
import {AtpAgent, RichText} from "@atproto/api";
import * as cheerio from "cheerio";
import mongoose from "mongoose";
import {loadAppConfig} from "../src/models/appConfig";
import {TriviaScore} from "../src/models/triviaScore";
import {triviaConnection} from "../src/models/triviaQuestion";
import {loadEnvFiles} from "../src/utils/envLoader";
import {
  type ParsedScore,
  extractHour,
  extractYear,
  resolveIframeUrl,
  parsePage,
} from "../src/utils/scoreParsing";

await loadEnvFiles(join(import.meta.dir, ".."));

const DEFAULT_URL =
  "https://www.90fmtrivia.org/TriviaScores2026/Results/TSK_results.html";
const SCRAPE_INTERVAL_MS = 5 * 60 * 1000;
const CONTEST_YEAR = 2026;

const CONTEST_START = new Date("2026-04-17T18:00:00-05:00");
const CONTEST_END = new Date("2026-04-20T17:00:00-05:00");

interface ParseResult {
  hour: number;
  year: number;
  scores: ParsedScore[];
}

/** Track which hours we've already posted about to avoid duplicate notifications. */
const postedHours = new Set<number>();

const postToBluesky = async (text: string): Promise<void> => {
  const config = await loadAppConfig();
  const {blueskyIdentifier, blueskyPassword} = config.triviaStats;
  if (!blueskyIdentifier || !blueskyPassword) {
    return;
  }
  try {
    const agent = new AtpAgent({service: "https://bsky.social"});
    await agent.login({identifier: blueskyIdentifier, password: blueskyPassword});
    const rt = new RichText({text});
    await rt.detectFacets(agent);
    await agent.post({text: rt.text, facets: rt.facets});
    console.info("  Posted to Bluesky");
  } catch (err) {
    console.warn("Bluesky post error:", err);
  }
};

const postToSlack = async (text: string): Promise<void> => {
  const config = await loadAppConfig();
  const webhook = config.triviaStats.slackWebhook;
  if (!webhook) {
    return;
  }
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({text}),
    });
    if (!response.ok) {
      console.warn(`Slack webhook returned ${response.status}`);
    }
  } catch (err) {
    console.warn("Slack webhook error:", err);
  }
};

const fetchAndParse = async (url: string, defaultYear?: number): Promise<ParseResult> => {
  const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  let html = await response.text();
  let $ = cheerio.load(html);

  const iframeUrl = resolveIframeUrl($, url);
  if (iframeUrl) {
    console.info(`  Found iframe, following: ${iframeUrl}`);
    const iframeResponse = await fetch(iframeUrl, {signal: AbortSignal.timeout(30000)});
    if (iframeResponse.ok) {
      html = await iframeResponse.text();
      $ = cheerio.load(html);
    }
  }

  const title = $("title").text() || $("h1").first().text() || $("h2").first().text() || "";
  console.info(`  Page title: "${title}"`);

  const {hour, scores} = parsePage($);
  const year = defaultYear || extractYear(title) || CONTEST_YEAR;

  return {hour, year, scores};
};

const saveScores = async (result: ParseResult): Promise<{inserted: number; updated: number}> => {
  let inserted = 0;
  let updated = 0;

  for (const s of result.scores) {
    const filter = {year: result.year, hour: result.hour, teamName: s.teamName};

    const existing = await TriviaScore.findOne(filter);
    if (existing) {
      let changed = false;
      if (existing.place !== s.place) {
        existing.place = s.place;
        changed = true;
      }
      if (existing.score !== s.score) {
        existing.score = s.score;
        changed = true;
      }
      if (changed) {
        existing.scrapedAt = new Date();
        await existing.save();
        updated++;
      }
    } else {
      await TriviaScore.create({
        year: result.year,
        hour: result.hour,
        place: s.place,
        teamName: s.teamName,
        score: s.score,
        scrapedAt: new Date(),
      });
      inserted++;
    }
  }

  return {inserted, updated};
};

const isWithinContestWindow = (): boolean => {
  const now = new Date();
  return now >= CONTEST_START && now <= CONTEST_END;
};

const findWiiTeam = (scores: ParsedScore[]): ParsedScore | undefined => {
  return scores.find((s) => /wii/i.test(s.teamName));
};

const scrapeOnce = async (url: string): Promise<void> => {
  console.info(`Scraping ${url}...`);
  const result = await fetchAndParse(url);
  console.info(`  Year: ${result.year}, Hour: ${result.hour}, Teams: ${result.scores.length}`);

  if (result.scores.length === 0) {
    console.warn("  No scores found on page");
    return;
  }

  const {inserted, updated} = await saveScores(result);
  console.info(`  DB: ${inserted} inserted, ${updated} updated`);

  if (inserted === 0 && updated === 0) {
    console.info("  No changes, skipping notifications");
    return;
  }

  const isNewHour = !postedHours.has(result.hour);
  postedHours.add(result.hour);

  if (!isNewHour) {
    console.info(`  Hour ${result.hour} already posted, skipping notifications`);
    return;
  }

  const hourLabel = result.hour > 0 ? `Hour ${result.hour}` : "Final";

  const wiiTeam = findWiiTeam(result.scores);
  const slackLines = [`<!channel> *Trivia ${result.year} — ${hourLabel} Scores*`];
  if (wiiTeam) {
    slackLines.push(`${wiiTeam.teamName}: #${wiiTeam.place} with ${wiiTeam.score.toLocaleString()} pts`);
  } else {
    slackLines.push(`${result.scores.length} teams scraped — no team with "wii" found`);
  }
  const slackMessage = slackLines.join("\n");

  const blueskyMessage = `Trivia ${result.year} — ${hourLabel} Scores are posted!\nhttp://www.90fmtrivia.org/TriviaScores2026/`;

  await Promise.all([postToSlack(slackMessage), postToBluesky(blueskyMessage)]);
};

const runLoop = async (url: string): Promise<void> => {
  console.info("Starting scrape loop (every 5 minutes during contest hours)");
  console.info(`Contest window: ${CONTEST_START.toISOString()} — ${CONTEST_END.toISOString()}`);

  const tick = async () => {
    if (!isWithinContestWindow()) {
      console.info(`[${new Date().toISOString()}] Outside contest window, skipping`);
      return;
    }

    try {
      await scrapeOnce(url);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Scrape failed:`, err);
    }
  };

  await tick();
  setInterval(tick, SCRAPE_INTERVAL_MS);
  await new Promise(() => {});
};

const waitForConnection = async (): Promise<void> => {
  if (triviaConnection.readyState === 1) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    triviaConnection.once("connected", resolve);
    triviaConnection.once("error", reject);
  });
};

/** Seed postedHours from the DB so we don't re-notify for hours already scraped. */
const seedPostedHours = async (): Promise<void> => {
  const existingHours = await TriviaScore.distinct("hour", {year: CONTEST_YEAR});
  for (const h of existingHours) {
    postedHours.add(h);
  }
  if (postedHours.size > 0) {
    console.info(`  Already have scores for hours: ${[...postedHours].sort((a, b) => a - b).join(", ")}`);
  }
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const loopMode = args.includes("--loop");
  const urlIdx = args.indexOf("--url");
  const url = urlIdx !== -1 && args[urlIdx + 1] ? args[urlIdx + 1] : DEFAULT_URL;

  const mainDbUri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://localhost:27017/shade";
  console.info("Connecting to databases...");
  await Promise.all([waitForConnection(), mongoose.connect(mainDbUri)]);
  console.info("Connected");

  if (loopMode) {
    await seedPostedHours();
    await runLoop(url);
  } else {
    await scrapeOnce(url);
    await Promise.all([triviaConnection.close(), mongoose.disconnect()]);
    console.info("Done.");
  }
};

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
