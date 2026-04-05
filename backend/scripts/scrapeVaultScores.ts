/**
 * Scrape all historical trivia scores from the 90FM Trivia vault.
 *
 * Usage:
 *   bun run scripts/scrapeVaultScores.ts             # Scrape all years
 *   bun run scripts/scrapeVaultScores.ts --year 2022  # Scrape a specific year
 */

import {join} from "node:path";
import * as cheerio from "cheerio";
import {TriviaScore} from "../src/models/triviaScore";
import {triviaConnection} from "../src/models/triviaQuestion";
import {loadEnvFiles} from "../src/utils/envLoader";
import {
  type ParsedScore,
  resolveIframeUrl,
  parsePage,
  fetchPage,
} from "../src/utils/scoreParsing";

await loadEnvFiles(join(import.meta.dir, ".."));

const SLACK_WEBHOOK = process.env.TRIVIA_STATS_SLACK_WEBHOOK;

const VAULT_SCORE_URLS: Array<{year: number; url: string}> = [
  {year: 1997, url: "http://www.90fmtrivia.org/scores97.htm"},
  {year: 1998, url: "http://www.90fmtrivia.org/scores98.htm"},
  {year: 1999, url: "http://www.90fmtrivia.org/scores99.htm"},
  {year: 2000, url: "http://www.90fmtrivia.org/scores00.htm"},
  {year: 2004, url: "http://www.90fmtrivia.org/trivia35scores.htm"},
  {year: 2005, url: "http://www.90fmtrivia.org/scoresTrivia36.html"},
  {year: 2006, url: "http://www.90fmtrivia.org/scorepage37.htm"},
  {year: 2007, url: "http://www.90fmtrivia.org/trivia38scores/trivia_page.html"},
  {year: 2008, url: "http://www.90fmtrivia.org/scores_page/triviapage2.html"},
  {year: 2009, url: "http://90fmtrivia.org/scores_page/Scores2009/trivia40Scores.html"},
  {year: 2010, url: "http://90fmtrivia.org/scores_page/Scores2010/index.php"},
  {year: 2011, url: "http://www.90fmtrivia.org/TriviaScores2011/super.html"},
  {year: 2012, url: "http://www.90fmtrivia.org/TriviaScores2012/trivia.html"},
  {year: 2013, url: "http://www.90fmtrivia.org/TriviaScores2013/trivia.html"},
  {year: 2014, url: "http://www.90fmtrivia.org/TriviaScores2014/trivia.html"},
  {year: 2015, url: "http://www.90fmtrivia.org/TriviaScores2015/trivia_scores_2015.html"},
  {year: 2016, url: "http://www.90fmtrivia.org/TriviaScores2016/trivia_scores_2016.html"},
  {year: 2017, url: "http://www.90fmtrivia.org/TriviaScores2017/trivia_scores_2017.html"},
  {year: 2018, url: "http://www.90fmtrivia.org/TriviaScores2018/trivia_scores_20182.html"},
  {year: 2021, url: "http://www.90fmtrivia.org/TriviaScores2021/Trivia%2051%20Scores!.html"},
  {year: 2022, url: "http://www.90fmtrivia.org/TriviaScores2022/Trivia%2052%20Scores!.html"},
  {year: 2023, url: "http://www.90fmtrivia.org/TriviaScores2023/"},
  {year: 2024, url: "http://www.90fmtrivia.org/TriviaScores2024/"},
  {year: 2025, url: "http://www.90fmtrivia.org/TriviaScores2025/"},
];

const postToSlack = async (text: string): Promise<void> => {
  if (!SLACK_WEBHOOK) {
    return;
  }
  try {
    const response = await fetch(SLACK_WEBHOOK, {
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

const findScoreSubpages = ($: cheerio.CheerioAPI, baseUrl: string): string[] => {
  const subpages: string[] = [];

  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().toLowerCase();

    if (
      /hour|hr|score|h\d+/i.test(href) ||
      /hour|hr|score/i.test(text) ||
      /\.htm[l]?$/i.test(href)
    ) {
      if (/vault|home|90fm\.org$/i.test(href)) {
        return;
      }

      let fullUrl: string;
      if (href.startsWith("http")) {
        fullUrl = href;
      } else {
        const base = baseUrl.endsWith("/") ? baseUrl : baseUrl.replace(/[^/]*$/, "");
        fullUrl = new URL(href, base).href;
      }

      if (!subpages.includes(fullUrl)) {
        subpages.push(fullUrl);
      }
    }
  });

  return subpages;
};

const saveScores = async (
  year: number,
  hour: number,
  scores: ParsedScore[]
): Promise<{inserted: number; updated: number}> => {
  let inserted = 0;
  let updated = 0;

  for (const s of scores) {
    const filter = {year, hour, teamName: s.teamName};

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
        year,
        hour,
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

const scrapeYear = async (year: number, url: string): Promise<void> => {
  console.info(`\n[${year}] Fetching ${url}`);

  const page = await fetchPage(url);
  if (!page) {
    return;
  }

  let {$} = page;

  const iframeUrl = resolveIframeUrl($, url);
  if (iframeUrl) {
    console.info(`  [${year}] Found iframe, following: ${iframeUrl}`);
    const iframePage = await fetchPage(iframeUrl);
    if (iframePage) {
      $ = iframePage.$;
    }
  }

  const {hour, scores} = parsePage($);

  if (scores.length > 0) {
    console.info(`  [${year}] Found ${scores.length} teams (hour: ${hour || "final"})`);
    const {inserted, updated} = await saveScores(year, hour, scores);
    console.info(`  [${year}] DB: ${inserted} inserted, ${updated} updated`);
  }

  const subpages = findScoreSubpages($, url);
  if (subpages.length > 0) {
    console.info(`  [${year}] Found ${subpages.length} subpage(s)`);

    for (const subUrl of subpages) {
      console.info(`  [${year}] Fetching subpage: ${subUrl}`);
      const subPage = await fetchPage(subUrl);
      if (!subPage) {
        continue;
      }

      const subResult = parsePage(subPage.$);
      if (subResult.scores.length > 0) {
        console.info(`  [${year}] Subpage: ${subResult.scores.length} teams (hour: ${subResult.hour || "final"})`);
        const {inserted, updated} = await saveScores(year, subResult.hour, subResult.scores);
        console.info(`  [${year}] Subpage DB: ${inserted} inserted, ${updated} updated`);
      } else {
        console.info(`  [${year}] Subpage: no scores found`);
      }

      await Bun.sleep(500);
    }
  }

  if (scores.length === 0 && subpages.length === 0) {
    console.warn(`  [${year}] No scores or subpages found`);
  }
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

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const filterYear = yearIdx !== -1 && args[yearIdx + 1] ? Number.parseInt(args[yearIdx + 1], 10) : null;

  console.info("Connecting to trivia database...");
  await waitForConnection();
  console.info("Connected");

  const targets = filterYear
    ? VAULT_SCORE_URLS.filter((t) => t.year === filterYear)
    : VAULT_SCORE_URLS;

  if (targets.length === 0) {
    console.error(`No vault entry found for year ${filterYear}`);
    process.exit(1);
  }

  console.info(`Scraping ${targets.length} year(s)...`);

  for (const target of targets) {
    await scrapeYear(target.year, target.url);
    await Bun.sleep(1000);
  }

  const summary = await TriviaScore.aggregate([
    {$group: {_id: "$year", teams: {$sum: 1}, hours: {$addToSet: "$hour"}}},
    {$sort: {_id: 1}},
  ]);

  console.info("\n=== Summary ===");
  const summaryLines: string[] = [];
  for (const row of summary) {
    const line = `  ${row._id}: ${row.teams} score entries across ${row.hours.length} hour(s)`;
    console.info(line);
    summaryLines.push(line);
  }

  const totalEntries = summary.reduce((sum: number, r: any) => sum + r.teams, 0);
  const slackMessage = [
    `*Trivia Vault Scrape Complete*`,
    `${targets.length} year(s) scraped, ${totalEntries} total score entries`,
    "",
    summaryLines.join("\n"),
  ].join("\n");
  await postToSlack(slackMessage);

  await triviaConnection.close();
  console.info("Done.");
};

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
