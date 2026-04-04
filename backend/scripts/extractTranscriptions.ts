/**
 * Script 1: Extract text from Slack transcription exports and create one text file per year.
 *
 * Reads all JSON files in ../transcriptions/ (Slack export format),
 * extracts message text, groups by year, and writes to transcriptions/YYYY.txt
 * with one Slack message per line.
 *
 * Handles both single-file exports (array of messages) and directory-based
 * Slack exports (channel folders with date-based JSON files).
 *
 * Usage: bun run scripts/extractTranscriptions.ts
 */

import {readdir, readFile, writeFile, stat} from "node:fs/promises";
import {join, extname} from "node:path";

const TRANSCRIPTIONS_DIR = join(import.meta.dir, "../../transcriptions");
const OUTPUT_DIR = TRANSCRIPTIONS_DIR;

interface SlackBlock {
  type?: string;
  text?: {text?: string};
  elements?: SlackBlockElement[];
}

interface SlackBlockElement {
  type?: string;
  text?: string;
  elements?: SlackBlockElement[];
}

interface SlackMessage {
  text?: string;
  ts?: string;
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  blocks?: SlackBlock[];
}

const extractYear = (ts: string): number => {
  // Slack timestamps are Unix epoch seconds with microseconds: "1609459200.000000"
  const epochSeconds = Number.parseFloat(ts);
  const date = new Date(epochSeconds * 1000);
  return date.getFullYear();
};

const extractBlockText = (blocks: SlackBlock[]): string => {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.text?.text) {
      parts.push(block.text.text);
    }
    if (block.elements) {
      for (const el of block.elements) {
        if (el.text) {
          parts.push(el.text);
        }
        if (el.elements) {
          for (const inner of el.elements) {
            if (inner.text) {
              parts.push(inner.text);
            }
          }
        }
      }
    }
  }
  return parts.join(" ").trim();
};

const isJunkLine = (text: string): boolean => {
  if (text === "This content can't be displayed.") return true;
  if (/^https?:\/\/s3\.amazonaws\.com/.test(text)) return true;
  if (/^https?:\/\//.test(text) && text.split(/\s+/).length <= 1) return true;
  if (text.length < 5) return true;
  return false;
};

const cleanText = (text: string): string => {
  // Remove Slack formatting artifacts but preserve the actual content
  return text
    .replace(/<@[A-Z0-9]+>/g, "") // Remove user mentions
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "$1") // Replace channel refs with name
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2") // Replace URL refs with label
    .replace(/<(https?:\/\/[^>]+)>/g, "$1") // Unwrap bare URLs
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
};

const collectJsonFiles = async (dir: string): Promise<string[]> => {
  const files: string[] = [];
  const entries = await readdir(dir, {withFileTypes: true});

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectJsonFiles(fullPath);
      files.push(...nested);
    } else if (extname(entry.name) === ".json") {
      files.push(fullPath);
    }
  }

  return files;
};

const main = async (): Promise<void> => {
  console.info(`Reading transcriptions from: ${TRANSCRIPTIONS_DIR}`);

  const dirStat = await stat(TRANSCRIPTIONS_DIR).catch(() => null);
  if (!dirStat?.isDirectory()) {
    console.error(`Directory not found: ${TRANSCRIPTIONS_DIR}`);
    console.error("Place your Slack export JSON files in the transcriptions/ directory.");
    process.exit(1);
  }

  const jsonFiles = await collectJsonFiles(TRANSCRIPTIONS_DIR);
  if (jsonFiles.length === 0) {
    console.error("No JSON files found in transcriptions/");
    console.error("Place your Slack export JSON files in the transcriptions/ directory.");
    process.exit(1);
  }

  console.info(`Found ${jsonFiles.length} JSON file(s)`);

  const messagesByYear = new Map<number, string[]>();
  let totalMessages = 0;

  for (const filePath of jsonFiles) {
    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw);

      // Handle both array of messages and object with messages property
      const messages: SlackMessage[] = Array.isArray(data) ? data : data.messages ?? [];

      for (const msg of messages) {
        if (msg.subtype === "channel_join" || msg.subtype === "channel_leave") {
          continue;
        }

        // Try top-level text first, fall back to block text
        let rawText = msg.text || "";
        if (isJunkLine(rawText) && msg.blocks?.length) {
          rawText = extractBlockText(msg.blocks);
        }
        if (!rawText) {
          continue;
        }

        // Clean and filter
        const text = cleanText(rawText);
        if (!text || isJunkLine(text)) {
          continue;
        }

        // Strip S3 URLs from lines that also have transcript text
        const textNoUrls = text.replace(/https?:\/\/s3\.amazonaws\.com\S*/g, "").trim();
        if (!textNoUrls || textNoUrls.length < 10) {
          continue;
        }

        let year: number;
        if (msg.ts) {
          year = extractYear(msg.ts);
        } else {
          // Try to infer year from filename (e.g., 2020-01-15.json)
          const match = filePath.match(/(\d{4})/);
          year = match ? Number.parseInt(match[1], 10) : new Date().getFullYear();
        }

        if (!messagesByYear.has(year)) {
          messagesByYear.set(year, []);
        }
        messagesByYear.get(year)!.push(textNoUrls);
        totalMessages++;
      }
    } catch (err) {
      console.warn(`Failed to parse ${filePath}: ${err}`);
    }
  }

  if (totalMessages === 0) {
    console.error("No messages extracted from any files.");
    process.exit(1);
  }

  // Write one file per year
  const years = [...messagesByYear.keys()].sort();
  for (const year of years) {
    const messages = messagesByYear.get(year)!;
    const outputPath = join(OUTPUT_DIR, `${year}.txt`);
    await writeFile(outputPath, messages.join("\n") + "\n", "utf-8");
    console.info(`Wrote ${messages.length} messages to ${outputPath}`);
  }

  console.info(`Done. Extracted ${totalMessages} messages across ${years.length} year(s): ${years.join(", ")}`);
};

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
