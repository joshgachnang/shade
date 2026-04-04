/**
 * Script 2: Parse trivia questions from yearly transcription text files using Claude API.
 *
 * Reads YYYY.txt files from transcriptions/, sends chunks to Claude to extract
 * trivia questions with hour, question number, question text, answer, and reasoning.
 * Stores results in the 'trivia' MongoDB database with deduplication.
 *
 * Trivia format: 54 hours, up to ~12 questions per hour.
 * Questions are read ~3 times: "question 1 of our 23, what is..."
 * Answers come later: "the answer to question 1 our 23, chewbacca"
 * Transcription is spotty so "our" appears instead of "hour", etc.
 *
 * Usage: bun run scripts/parseQuestions.ts
 *   ANTHROPIC_API_KEY must be set (in ~/.config/shade/shade-backend.env, backend/.env, or env var)
 *   Optional: CLAUDE_MODEL (default: claude-haiku-4-5-20251001)
 *   Optional: CONCURRENCY (default: 10)
 */

import {readdir, readFile} from "node:fs/promises";
import {join, basename} from "node:path";
import {homedir} from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import mongoose from "mongoose";
import {TriviaQuestion, triviaConnection} from "../src/models/triviaQuestion";

// Load env files (shade-backend.env first, then backend/.env as fallback)
const envFiles = [
  join(homedir(), ".config/shade/shade-backend.env"),
  join(import.meta.dir, "../.env"),
];

for (const envPath of envFiles) {
  const envFile = Bun.file(envPath);
  if (await envFile.exists()) {
    const text = await envFile.text();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

const TRANSCRIPTIONS_DIR = join(import.meta.dir, "../../transcriptions");
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY || "10", 10);
const CHUNK_SIZE = 100; // lines per chunk — each line is a long transcript segment
const CHUNK_OVERLAP = 10; // overlap to catch questions split across chunks

interface ParsedQuestion {
  hour: number;
  questionNumber: number;
  questionText: string;
  answer: string;
  reasoning: string;
}

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `You are a trivia question extraction system. You will receive transcribed text from the WWSP 90FM Trivia contest broadcast in Stevens Point, Wisconsin.

Your job is to extract individual trivia questions, their hour number, question number, question text, answer, and your reasoning.

CRITICAL TRANSCRIPTION PATTERNS:
- "our nine" or "our 9" means "hour 9" — the word "hour" is almost always transcribed as "our" or "are"
- "question number one of our nine" = question 1 of hour 9
- "question two of our 10" = question 2 of hour 10
- "question won" = "question one"
- Numbers may be spelled out: "twenty three" = 23
- "the answer to question number one of our nine is Bailey" = answer to Q1 H9 is "Bailey"
- "on to question number two, our 10" = starting question 2 of hour 10
- Each line starts with a timestamp like "2:03:16:" followed by transcribed speech

WHAT TO EXTRACT:
- Look for patterns like "question number X of our Y" to identify questions
- Look for "the answer to question X" or "the answer is" to identify answers
- Questions are typically read 2-3 times, then the answer is given
- There is lots of banter, ads, music lyrics, and news — skip all of that

For each question you find, return a JSON object with:
- hour: number (1-54)
- questionNumber: number (1-12)
- questionText: string (the actual trivia question, cleaned up)
- answer: string (the answer if given in this chunk, or "" if not found)
- reasoning: string (explain your extraction, transcription corrections, confidence, alternative answers)

Return ONLY a JSON array. No markdown, no explanation outside the array.
If no questions found, return []`;

const parseChunk = async (chunk: string, year: number, chunkId: string): Promise<ParsedQuestion[]> => {
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Year: ${year}\n\nTranscript chunk:\n${chunk}`,
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (q: any) =>
          typeof q.hour === "number" &&
          typeof q.questionNumber === "number" &&
          typeof q.questionText === "string" &&
          q.hour >= 1 &&
          q.hour <= 54 &&
          q.questionNumber >= 1 &&
          q.questionNumber <= 12
      )
      .map((q: any) => ({
        hour: q.hour,
        questionNumber: q.questionNumber,
        questionText: q.questionText.trim(),
        answer: typeof q.answer === "string" ? q.answer.trim() : "",
        reasoning: typeof q.reasoning === "string" ? q.reasoning : "",
      }));
  } catch (err) {
    console.warn(`  [${chunkId}] Claude API error: ${err}`);
    return [];
  }
};

const runBatch = async <T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
};

const deduplicateAndMerge = (questions: ParsedQuestion[]): ParsedQuestion[] => {
  const map = new Map<string, ParsedQuestion>();

  for (const q of questions) {
    const key = `${q.hour}-${q.questionNumber}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {...q});
      continue;
    }

    if (q.questionText.length > existing.questionText.length) {
      existing.questionText = q.questionText;
    }
    if (q.answer && (!existing.answer || q.answer.length > existing.answer.length)) {
      existing.answer = q.answer;
    }
    if (q.reasoning) {
      existing.reasoning = existing.reasoning
        ? `${existing.reasoning}\n---\n${q.reasoning}`
        : q.reasoning;
    }
  }

  return [...map.values()];
};

const processYear = async (filePath: string, year: number): Promise<void> => {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  console.info(`\nProcessing year ${year}: ${lines.length} lines`);

  // Build all chunks
  const chunks: {text: string; id: string; startLine: number}[] = [];
  for (let i = 0; i < lines.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    const chunkLines = lines.slice(i, i + CHUNK_SIZE);
    const chunkNum = chunks.length + 1;
    chunks.push({
      text: chunkLines.join("\n"),
      id: `${year}-chunk${chunkNum}`,
      startLine: i + 1,
    });
  }

  console.info(`  ${chunks.length} chunks, processing ${CONCURRENCY} at a time...`);

  // Process chunks in parallel batches
  const chunkResults = await runBatch(chunks, CONCURRENCY, async (chunk) => {
    const questions = await parseChunk(chunk.text, year, chunk.id);
    if (questions.length > 0) {
      console.info(`  [${chunk.id}] Found ${questions.length} question(s): ${questions.map((q) => `H${q.hour}Q${q.questionNumber}`).join(", ")}`);
    } else {
      process.stdout.write(".");
    }
    return questions;
  });

  const allQuestions = chunkResults.flat();
  process.stdout.write("\n");

  // Deduplicate within the year
  const merged = deduplicateAndMerge(allQuestions);
  console.info(`  Year ${year}: ${merged.length} unique questions (from ${allQuestions.length} raw extractions)`);

  // Upsert into MongoDB
  let inserted = 0;
  let updated = 0;

  for (const q of merged) {
    const filter = {year, hour: q.hour, questionNumber: q.questionNumber};
    const existing = await TriviaQuestion.findOne(filter);

    if (existing) {
      let changed = false;

      if (q.questionText.length > existing.questionText.length) {
        existing.questionText = q.questionText;
        changed = true;
      }
      if (q.answer && (!existing.answer || q.answer.length > existing.answer.length)) {
        existing.answer = q.answer;
        changed = true;
      }
      if (q.reasoning && !existing.reasoning.includes(q.reasoning)) {
        existing.reasoning = existing.reasoning
          ? `${existing.reasoning}\n---\n${q.reasoning}`
          : q.reasoning;
        changed = true;
      }

      if (changed) {
        await existing.save();
        updated++;
      }
    } else {
      await TriviaQuestion.create({
        ...q,
        year,
        rawExcerpts: [],
      });
      inserted++;
    }
  }

  console.info(`  DB: ${inserted} inserted, ${updated} updated`);
};

const main = async (): Promise<void> => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required.");
    console.error("Set it in ~/.config/shade/shade-backend.env, backend/.env, or as an environment variable.");
    process.exit(1);
  }

  console.info(`Using model: ${MODEL}`);
  console.info(`Concurrency: ${CONCURRENCY}`);
  console.info("Connecting to trivia database...");

  await new Promise<void>((resolve, reject) => {
    if (triviaConnection.readyState === 1) {
      resolve();
      return;
    }
    triviaConnection.on("connected", resolve);
    triviaConnection.on("error", reject);
  });

  console.info("Connected to trivia database");

  const entries = await readdir(TRANSCRIPTIONS_DIR);
  const yearFiles = entries
    .filter((f) => /^\d{4}\.txt$/.test(f))
    .sort();

  if (yearFiles.length === 0) {
    console.error("No year files found (e.g., 2020.txt). Run extractTranscriptions.ts first.");
    process.exit(1);
  }

  console.info(`Found year files: ${yearFiles.join(", ")}`);

  for (const file of yearFiles) {
    const year = Number.parseInt(basename(file, ".txt"), 10);
    await processYear(join(TRANSCRIPTIONS_DIR, file), year);
  }

  // Print summary
  const totalByYear = await TriviaQuestion.aggregate([
    {$group: {_id: "$year", count: {$sum: 1}}},
    {$sort: {_id: 1}},
  ]);

  console.info("\n=== Summary ===");
  for (const row of totalByYear) {
    console.info(`  ${row._id}: ${row.count} questions`);
  }

  const total = totalByYear.reduce((sum: number, r: any) => sum + r.count, 0);
  console.info(`  Total: ${total} questions`);

  await triviaConnection.close();
  console.info("Done.");
};

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
