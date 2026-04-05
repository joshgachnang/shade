/**
 * Real-time trivia question answerer.
 *
 * Watches the Transcript collection for new entries from the live radio stream,
 * accumulates text in a sliding window, detects new trivia questions using Claude,
 * then researches answers using a multi-turn approach with web search and saves
 * results to the trivia database.
 *
 * Answer pipeline:
 *   1. Claude identifies the source work (movie/show/song/etc)
 *   2. Search past questions DB for similar questions from prior years
 *   3. Brave web search to verify and find specific details
 *   4. Claude synthesizes all evidence into a final answer
 *   5. If confidence is low, re-run with extended thinking
 *
 * Usage:
 *   bun run scripts/triviaAnswerer.ts                          # Watch for new transcripts
 *   bun run scripts/triviaAnswerer.ts --stream <radioStreamId>  # Filter to a specific stream
 *   bun run scripts/triviaAnswerer.ts --test "question text"    # Test answer lookup on a single question
 *
 * Env vars:
 *   ANTHROPIC_API_KEY        — Required
 *   BRAVE_SEARCH_API_KEY     — For web search (strongly recommended)
 *   TRIVIA_MONGO_URI         — Trivia DB (default: mongodb://localhost:27017/trivia)
 *   ANSWERER_MODEL           — Claude model for answering (default: claude-sonnet-4-20250514)
 *   DETECTOR_MODEL           — Claude model for detection (default: claude-haiku-4-5-20251001)
 *   POLL_INTERVAL_MS         — How often to check for new transcripts (default: 5000)
 */

import {join} from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import mongoose from "mongoose";
import {TriviaQuestion, triviaConnection} from "../src/models/triviaQuestion";
import {braveSearch, formatSearchResults} from "../src/utils/webSearch";
import {loadEnvFiles} from "../src/utils/envLoader";

await loadEnvFiles(join(import.meta.dir, ".."));

const ANSWERER_MODEL = process.env.ANSWERER_MODEL || "claude-sonnet-4-20250514";
const DETECTOR_MODEL = process.env.DETECTOR_MODEL || "claude-haiku-4-5-20251001";
const POLL_INTERVAL_MS = Number.parseInt(process.env.POLL_INTERVAL_MS || "5000", 10);
const TRANSCRIPT_WINDOW_SIZE = 20;

const anthropic = new Anthropic();

// ── Main DB connection (for Transcript collection) ─────────────────────────
const mainConnection = mongoose.createConnection(
  process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://localhost:27017/shade"
);

// ── Contest rules context ──────────────────────────────────────────────────

const CONTEST_RULES = `ABOUT THE 90FM TRIVIA CONTEST:
- This is a 54-hour trivia contest broadcast on WWSP 90FM in Stevens Point, Wisconsin
- 8 questions are asked each hour over the airwaves. Teams have the length of 2 songs to call in an answer.
- Each team gets ONE attempt per question. Calling more than once = zero points for that question.
- All correct teams split 2000 points equally (min 5, max 500 per team).
- There are special hours with only 4 questions (to read standings), and midnight hours with 10 questions and longer songs.
- Teams receive the "New Trivia Times" newspaper at registration which contains pictures and other contest info.
- "New Trivia Times picture number X" questions REQUIRE this physical newspaper.

ANSWER CONVENTIONS:
- Unless otherwise specified, the contest is looking for the PERFORMING NAME (stage name, screen name), not birth name.
- When they ask for "first and last name", give the performing name with both first and last.
- When they say "big screen" they mean a movie/film.
- When they say "small screen" or "television" they mean a TV show/series.
- Answers are almost always very short: 1-4 words, averaging 13 characters.`;

// ── Prompts ────────────────────────────────────────────────────────────────

const DETECTOR_SYSTEM_PROMPT = `You are a trivia question detector for the WWSP 90FM Trivia contest broadcast.

You receive a rolling window of transcribed radio text. Your job is to detect NEW trivia questions being read.

TRANSCRIPTION PATTERNS:
- "our nine" or "our 9" = "hour 9" (the word "hour" is almost always transcribed as "our" or "are")
- "question number one of our nine" = question 1 of hour 9
- "question won" = "question one"
- Numbers may be spelled out: "twenty three" = 23
- Questions are read 2-3 times, then the answer is given later
- "the answer to question number X" signals an answer, not a new question

WHAT TO DO:
- Extract any NEW complete trivia questions you see (not answers being read)
- A question is complete when the DJ finishes reading it (look for the full question text)
- Ignore: banter, ads, music, news, station IDs, score updates
- If you see the same question being re-read, skip it

Return a JSON array of detected questions. Each entry:
{
  "hour": number (1-54),
  "questionNumber": number (1-12),
  "questionText": string (the actual question, cleaned up and coherent),
  "skipReason": string | null (set if this question CANNOT be researched — see below)
}

SKIP REASONS — set skipReason if the question matches any of these:
- "picture" — references "New Trivia Times picture number X" or "Trivia Times" images (requires physical newspaper)
- "sing" — asks the team to "call in and sing", perform, hum, or whistle something
- "packaging" — asks about text/images on specific product packaging, labels, wrappers, or boxes that would require having the physical item
- "local" — asks about something only findable by physically being in Stevens Point or at WWSP

If the question CAN be researched (even if hard), set skipReason to null.

Return ONLY a JSON array. No markdown, no explanation.
If no new questions found, return [].`;

const IDENTIFIER_SYSTEM_PROMPT = `You are phase 1 of a trivia research pipeline for the WWSP 90FM Trivia contest.

${CONTEST_RULES}

Your job is to IDENTIFY THE SOURCE WORK being described in the question. Do NOT try to answer the final question yet.

Parse the clues and figure out:
- What movie, TV show, song, album, book, product, commercial, or real-world event is being described?
- What specific scene, episode, or moment is referenced?
- Which characters or people are involved?

Key vocabulary:
- "big screen" = movie/film
- "small screen" / "television" = TV show/series
- "a character" (unnamed) = you must figure out who
- "according to" = references a specific real-world source
- "a performer" / "an artist" = real person, unnamed
- "a song" / "a hit record" = must identify the song

Return a JSON object:
{
  "sourceWork": "name of the movie/show/song/etc",
  "sourceType": "movie" | "tv" | "song" | "book" | "product" | "commercial" | "real_event" | "unknown",
  "scene": "description of the specific scene/moment referenced",
  "characters": ["list of characters/people involved"],
  "confidence": "high" | "medium" | "low",
  "reasoning": "how you identified this",
  "searchQueries": ["2-3 specific web searches to verify this identification and find the answer"]
}

Return ONLY the JSON object. No markdown wrapping.`;

const ANSWERER_SYSTEM_PROMPT = `You are the final phase of a trivia research pipeline for the WWSP 90FM Trivia contest.

${CONTEST_RULES}

You will receive:
1. The original trivia question
2. The identified source work (from phase 1)
3. Similar past questions and answers from prior years (if any)
4. Web search results (if available)

Your job is to synthesize all this evidence and give the most accurate answer possible.

CRITICAL — RE-READ THE QUESTION CAREFULLY:
These questions contain subtle traps. Before answering:
- Identify EXACTLY which character/person/thing the question asks about — not the most famous one, the SPECIFIC one described
- Pay close attention to who does what: "admitted to his partner that he couldn't swim" — who admitted? who is the partner?
- "the actor who played the role of the character who..." — trace the chain: which CHARACTER → which ACTOR
- If the question says "first and last name", give the PERFORMING NAME with both first and last
- Watch for misdirection: the question may describe character A to set context but ask about character B
- The question may describe a chain of events — make sure you're answering about the right link in the chain

ANSWER FORMAT — Return a JSON object:
{
  "answer": "your best answer (short, specific — just the answer itself)",
  "confidence": "high" | "medium" | "low",
  "sourceIdentified": "what movie/show/song/etc this is about",
  "reasoning": "brief explanation: (1) source identified, (2) which specific detail is being asked about, (3) how you arrived at the answer, (4) what evidence supports it",
  "alternateAnswers": ["other possible answers, most likely first"],
  "searchSuggestions": ["additional searches if still uncertain"]
}

IMPORTANT:
- Do NOT fabricate answers. If you don't know, say so and provide search directions.
- Use the web search results as evidence — they may confirm or contradict your initial guess.
- Past question patterns matter: if a similar question was asked before, the answer style/format is a strong hint.
- When you have medium/low confidence, ALWAYS populate searchSuggestions and alternateAnswers.

Return ONLY the JSON object. No markdown wrapping.`;

// ── Types ──────────────────────────────────────────────────────────────────

interface DetectedQuestion {
  hour: number;
  questionNumber: number;
  questionText: string;
  skipReason: string | null;
}

interface SourceIdentification {
  sourceWork: string;
  sourceType: string;
  scene: string;
  characters: string[];
  confidence: string;
  reasoning: string;
  searchQueries: string[];
}

interface AnswerResult {
  answer: string;
  confidence: "high" | "medium" | "low";
  sourceIdentified: string;
  reasoning: string;
  alternateAnswers: string[];
  searchSuggestions: string[];
}

// ── State ──────────────────────────────────────────────────────────────────

const processedQuestions = new Set<string>();
const transcriptWindow: string[] = [];

// ── Past question lookup ───────────────────────────────────────────────────

const findSimilarPastQuestions = async (questionText: string): Promise<string> => {
  try {
    const currentYear = new Date().getFullYear();

    // Extract key phrases for text search — take significant words
    const words = questionText
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 4);

    if (words.length === 0) {
      return "";
    }

    // Search for questions containing similar keywords using regex
    // Pick the 3-4 most distinctive words
    const searchWords = words.slice(0, 4);
    const regex = searchWords.map((w) => `(?=.*${w})`).join("");

    const similar = await TriviaQuestion.find({
      year: {$lt: currentYear},
      questionText: {$regex: regex, $options: "i"},
    })
      .sort({year: -1})
      .limit(5)
      .lean();

    if (similar.length === 0) {
      return "";
    }

    const lines = similar.map(
      (q: any) =>
        `[${q.year} H${q.hour} Q${q.questionNumber}] Q: ${q.questionText}\n  A: ${q.answer || "(no answer recorded)"}`
    );

    return `SIMILAR PAST QUESTIONS:\n${lines.join("\n\n")}`;
  } catch (err) {
    console.warn("Past question lookup error:", err);
    return "";
  }
};

// ── Core pipeline ──────────────────────────────────────────────────────────

const detectQuestions = async (windowText: string): Promise<DetectedQuestion[]> => {
  try {
    const response = await anthropic.messages.create({
      model: DETECTOR_MODEL,
      max_tokens: 2048,
      system: DETECTOR_SYSTEM_PROMPT,
      messages: [{role: "user", content: windowText}],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (q: any) =>
        typeof q.hour === "number" &&
        typeof q.questionNumber === "number" &&
        typeof q.questionText === "string" &&
        q.hour >= 1 &&
        q.hour <= 54 &&
        q.questionNumber >= 1 &&
        q.questionNumber <= 12
    );
  } catch (err) {
    console.error("Question detection error:", err);
    return [];
  }
};

/**
 * Phase 1: Identify the source work being described.
 */
const identifySource = async (questionText: string): Promise<SourceIdentification> => {
  const defaultResult: SourceIdentification = {
    sourceWork: "",
    sourceType: "unknown",
    scene: "",
    characters: [],
    confidence: "low",
    reasoning: "Failed to identify",
    searchQueries: [],
  };

  try {
    const response = await anthropic.messages.create({
      model: ANSWERER_MODEL,
      max_tokens: 1024,
      system: IDENTIFIER_SYSTEM_PROMPT,
      messages: [{role: "user", content: questionText}],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return defaultResult;
    }

    return {...defaultResult, ...JSON.parse(jsonMatch[0])};
  } catch (err) {
    console.error("Source identification error:", err);
    return defaultResult;
  }
};

/**
 * Phase 2: Run web searches to gather evidence.
 */
const searchForEvidence = async (
  questionText: string,
  source: SourceIdentification
): Promise<string> => {
  if (!process.env.BRAVE_SEARCH_API_KEY) {
    return "";
  }

  const allResults: string[] = [];

  // Run the source's suggested search queries
  const queries = source.searchQueries.slice(0, 3);

  // Also add a direct question search
  const directQuery = questionText
    .replace(/what is the|who is the|what are the/gi, "")
    .substring(0, 200)
    .trim();
  if (directQuery.length > 20) {
    queries.push(directQuery);
  }

  for (const query of queries) {
    console.info(`    Searching: "${query}"`);
    const results = await braveSearch(query, {count: 3});
    if (results.length > 0) {
      allResults.push(`Search: "${query}"\n${formatSearchResults(results)}`);
    }
  }

  if (allResults.length === 0) {
    return "";
  }

  return `WEB SEARCH RESULTS:\n\n${allResults.join("\n\n---\n\n")}`;
};

/**
 * Phase 3: Synthesize all evidence into a final answer.
 */
const synthesizeAnswer = async (
  questionText: string,
  source: SourceIdentification,
  pastQuestions: string,
  searchEvidence: string,
  useExtendedThinking: boolean
): Promise<AnswerResult> => {
  const defaultResult: AnswerResult = {
    answer: "",
    confidence: "low",
    sourceIdentified: "",
    reasoning: "Failed to synthesize",
    alternateAnswers: [],
    searchSuggestions: [],
  };

  const contextParts = [
    `ORIGINAL QUESTION:\n${questionText}`,
    "",
    `IDENTIFIED SOURCE:\n- Work: ${source.sourceWork} (${source.sourceType})\n- Scene: ${source.scene}\n- Characters: ${source.characters.join(", ")}\n- Identification confidence: ${source.confidence}\n- Reasoning: ${source.reasoning}`,
  ];

  if (pastQuestions) {
    contextParts.push("", pastQuestions);
  }

  if (searchEvidence) {
    contextParts.push("", searchEvidence);
  }

  const userMessage = contextParts.join("\n");

  try {
    if (useExtendedThinking) {
      console.info("    Using extended thinking...");
      const response = await anthropic.messages.create({
        model: ANSWERER_MODEL,
        max_tokens: 16000,
        thinking: {
          type: "enabled",
          budget_tokens: 10000,
        },
        messages: [{role: "user", content: `${ANSWERER_SYSTEM_PROMPT}\n\n${userMessage}`}],
      });

      // Extract text from thinking response
      for (const block of response.content) {
        if (block.type === "text") {
          const jsonMatch = block.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return {...defaultResult, ...JSON.parse(jsonMatch[0])};
          }
        }
      }
      return defaultResult;
    }

    const response = await anthropic.messages.create({
      model: ANSWERER_MODEL,
      max_tokens: 1024,
      system: ANSWERER_SYSTEM_PROMPT,
      messages: [{role: "user", content: userMessage}],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return defaultResult;
    }

    return {...defaultResult, ...JSON.parse(jsonMatch[0])};
  } catch (err) {
    console.error("Answer synthesis error:", err);
    return defaultResult;
  }
};

/**
 * Full answer pipeline: identify → search past questions → web search → synthesize → retry with thinking if needed.
 */
const answerQuestion = async (questionText: string): Promise<AnswerResult> => {
  // Phase 1: Identify the source
  console.info("  Phase 1: Identifying source...");
  const source = await identifySource(questionText);
  console.info(`  Source: ${source.sourceWork} (${source.confidence})`);

  // Phase 2: Search past questions
  console.info("  Phase 2: Searching past questions...");
  const pastQuestions = await findSimilarPastQuestions(questionText);
  if (pastQuestions) {
    console.info("  Found similar past questions");
  }

  // Phase 3: Web search for evidence
  console.info("  Phase 3: Web searching...");
  const searchEvidence = await searchForEvidence(questionText, source);

  // Phase 4: Synthesize answer
  console.info("  Phase 4: Synthesizing answer...");
  let result = await synthesizeAnswer(questionText, source, pastQuestions, searchEvidence, false);

  // Phase 5: If low confidence, retry with extended thinking
  if (result.confidence === "low" && result.answer) {
    console.info("  Phase 5: Low confidence — retrying with extended thinking...");
    const retryResult = await synthesizeAnswer(questionText, source, pastQuestions, searchEvidence, true);
    if (retryResult.confidence !== "low" || retryResult.answer) {
      result = retryResult;
    }
  }

  return result;
};

// ── Process question ───────────────────────────────────────────────────────

const processQuestion = async (question: DetectedQuestion): Promise<void> => {
  const key = `H${question.hour}Q${question.questionNumber}`;

  if (processedQuestions.has(key)) {
    return;
  }
  processedQuestions.add(key);

  console.info(`\n[${key}] Detected: ${question.questionText.substring(0, 100)}...`);

  const year = new Date().getFullYear();
  try {
    await TriviaQuestion.findOneAndUpdate(
      {year, hour: question.hour, questionNumber: question.questionNumber},
      {
        year,
        hour: question.hour,
        questionNumber: question.questionNumber,
        questionText: question.questionText,
      },
      {upsert: true, new: true}
    );
  } catch (err) {
    console.warn(`[${key}] DB save error:`, err);
  }

  if (question.skipReason) {
    console.info(`[${key}] Skipping: ${question.skipReason}`);
    return;
  }

  console.info(`[${key}] Researching answer...`);
  const result = await answerQuestion(question.questionText);

  console.info(`[${key}] Answer: ${result.answer} (${result.confidence})`);
  if (result.sourceIdentified) {
    console.info(`[${key}] Source: ${result.sourceIdentified}`);
  }
  if (result.reasoning) {
    console.info(`[${key}] Reasoning: ${result.reasoning}`);
  }
  if (result.alternateAnswers.length > 0) {
    console.info(`[${key}] Alternates: ${result.alternateAnswers.join(", ")}`);
  }
  if (result.searchSuggestions.length > 0) {
    console.info(`[${key}] Search: ${result.searchSuggestions.join(" | ")}`);
  }

  try {
    await TriviaQuestion.findOneAndUpdate(
      {year, hour: question.hour, questionNumber: question.questionNumber},
      {
        answer: result.answer || "",
        reasoning: [
          `Confidence: ${result.confidence}`,
          `Source: ${result.sourceIdentified}`,
          result.reasoning,
          result.alternateAnswers.length > 0 ? `Alternates: ${result.alternateAnswers.join(", ")}` : "",
          result.searchSuggestions.length > 0 ? `Search: ${result.searchSuggestions.join(" | ")}` : "",
        ].filter(Boolean).join("\n"),
      }
    );
  } catch (err) {
    console.warn(`[${key}] DB answer save error:`, err);
  }
};

// ── Watch mode ─────────────────────────────────────────────────────────────

const watchTranscripts = async (streamFilter?: string): Promise<void> => {
  console.info("Waiting for main DB connection...");
  if (mainConnection.readyState !== 1) {
    await new Promise<void>((resolve, reject) => {
      mainConnection.on("connected", resolve);
      mainConnection.on("error", reject);
    });
  }

  console.info("Waiting for trivia DB connection...");
  if (triviaConnection.readyState !== 1) {
    await new Promise<void>((resolve, reject) => {
      triviaConnection.on("connected", resolve);
      triviaConnection.on("error", reject);
    });
  }

  console.info("Connected to both databases");
  console.info(`Detector model: ${DETECTOR_MODEL}`);
  console.info(`Answerer model: ${ANSWERER_MODEL}`);
  console.info(`Brave search: ${process.env.BRAVE_SEARCH_API_KEY ? "configured" : "NOT SET"}`);
  console.info(`Poll interval: ${POLL_INTERVAL_MS}ms`);

  const transcriptsCollection = mainConnection.db.collection("transcripts");

  let lastSeenId: mongoose.Types.ObjectId | null = null;

  const latest = await transcriptsCollection.findOne(
    streamFilter ? {radioStreamId: new mongoose.Types.ObjectId(streamFilter)} : {},
    {sort: {_id: -1}}
  );
  if (latest) {
    lastSeenId = latest._id as mongoose.Types.ObjectId;
    console.info(`Starting from transcript ${lastSeenId}`);
  }

  console.info("Watching for new transcripts...\n");

  const poll = async () => {
    try {
      const query: any = {};
      if (lastSeenId) {
        query._id = {$gt: lastSeenId};
      }
      if (streamFilter) {
        query.radioStreamId = new mongoose.Types.ObjectId(streamFilter);
      }

      const newTranscripts = await transcriptsCollection
        .find(query)
        .sort({_id: 1})
        .limit(10)
        .toArray();

      if (newTranscripts.length === 0) {
        return;
      }

      for (const t of newTranscripts) {
        lastSeenId = t._id as mongoose.Types.ObjectId;
        const content = t.content as string;

        if (!content || content.trim().length < 10) {
          continue;
        }

        transcriptWindow.push(content);
        if (transcriptWindow.length > TRANSCRIPT_WINDOW_SIZE) {
          transcriptWindow.shift();
        }
      }

      const windowText = transcriptWindow.join("\n\n");
      const questions = await detectQuestions(windowText);

      for (const q of questions) {
        await processQuestion(q);
      }
    } catch (err) {
      console.error("Poll error:", err);
    }
  };

  await poll();
  setInterval(poll, POLL_INTERVAL_MS);

  await new Promise(() => {});
};

// ── Test mode ──────────────────────────────────────────────────────────────

const testQuestion = async (questionText: string): Promise<void> => {
  // Connect to trivia DB for past question lookup
  if (triviaConnection.readyState !== 1) {
    await new Promise<void>((resolve, reject) => {
      triviaConnection.on("connected", resolve);
      triviaConnection.on("error", reject);
    });
  }

  console.info("Testing answer for question:");
  console.info(`  ${questionText}\n`);

  const result = await answerQuestion(questionText);

  console.info(`\nFINAL RESULT:`);
  console.info(`  Answer: ${result.answer}`);
  console.info(`  Confidence: ${result.confidence}`);
  console.info(`  Source: ${result.sourceIdentified}`);
  console.info(`  Reasoning: ${result.reasoning}`);
  if (result.alternateAnswers.length > 0) {
    console.info(`  Alternates: ${result.alternateAnswers.join(", ")}`);
  }
  if (result.searchSuggestions.length > 0) {
    console.info(`  Search: ${result.searchSuggestions.join(" | ")}`);
  }

  await triviaConnection.close();
};

// ── Main ───────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required.");
    process.exit(1);
  }

  const args = process.argv.slice(2);

  const testIdx = args.indexOf("--test");
  if (testIdx !== -1) {
    const question = args.slice(testIdx + 1).join(" ");
    if (!question) {
      console.error("Usage: --test <question text>");
      process.exit(1);
    }
    await testQuestion(question);
    return;
  }

  const streamIdx = args.indexOf("--stream");
  const streamId = streamIdx !== -1 ? args[streamIdx + 1] : undefined;

  await watchTranscripts(streamId);
};

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
