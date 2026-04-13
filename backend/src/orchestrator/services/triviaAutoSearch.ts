/**
 * Trivia Auto-Search service.
 *
 * Watches transcripts for trivia questions when enabled via AppConfig.
 * Uses a two-phase answer pipeline:
 *   1. LLM-only (fast): If high confidence, post immediately
 *   2. Combined search (all 3 engines): If LLM has clues but not a definitive answer,
 *      post what we know, then search and post the full answer
 *
 * Also handles manual questions from allowed users via "!trivia <question>" in chat.
 */

import Anthropic from "@anthropic-ai/sdk";
import {logger} from "@terreno/api";
import mongoose from "mongoose";
import {loadAppConfig} from "../../models/appConfig";
import {TriviaQuestion, triviaConnection} from "../../models/triviaQuestion";
import {combinedSearch} from "../../utils/search/combinedSearch";
import {formatSearchResults} from "../../utils/search/types";
import type {ChannelManager} from "../channels/manager";

const ANSWERER_MODEL = process.env.ANSWERER_MODEL || "claude-sonnet-4-20250514";
const DETECTOR_MODEL = process.env.DETECTOR_MODEL || "claude-haiku-4-5-20251001";
const POLL_INTERVAL_MS = 5000;
const TRANSCRIPT_WINDOW_SIZE = 20;

const anthropic = new Anthropic();

// ── Contest rules ──────────────────────────────────────────────────────────

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

const QUICK_ANSWER_SYSTEM_PROMPT = `You are a trivia answering engine for the WWSP 90FM Trivia contest.

${CONTEST_RULES}

You will receive a trivia question. Answer it using ONLY your internal knowledge — no web search is available.

CRITICAL — RE-READ THE QUESTION CAREFULLY:
These questions contain subtle traps. Before answering:
- Identify EXACTLY which character/person/thing the question asks about — not the most famous one, the SPECIFIC one described
- Pay close attention to who does what: "admitted to his partner that he couldn't swim" — who admitted? who is the partner?
- "the actor who played the role of the character who..." — trace the chain: which CHARACTER → which ACTOR
- If the question says "first and last name", give the PERFORMING NAME with both first and last
- Watch for misdirection: the question may describe character A to set context but ask about character B

Return a JSON object:
{
  "answer": "your best answer (short, specific — just the answer itself)",
  "confidence": "high" | "medium" | "low",
  "sourceIdentified": "what movie/show/song/etc this is about",
  "reasoning": "brief explanation of how you arrived at the answer",
  "alternateAnswers": ["other possible answers, most likely first"],
  "searchQueries": ["2-3 specific web searches that would help verify or find the answer"]
}

CONFIDENCE GUIDELINES:
- "high": You are very confident (90%+) this is correct. You know the source material well and the answer is clear.
- "medium": You have a good idea of the source material and a likely answer, but aren't certain of the specific detail asked.
- "low": You're guessing or don't recognize the source material at all.

IMPORTANT:
- Do NOT fabricate answers. If you don't know, set confidence to "low".
- Always populate searchQueries — even with high confidence, these help verify.
- Always populate alternateAnswers if there's any ambiguity.

Return ONLY the JSON object. No markdown wrapping.`;

const SEARCH_ANSWER_SYSTEM_PROMPT = `You are the final phase of a trivia research pipeline for the WWSP 90FM Trivia contest.

${CONTEST_RULES}

You will receive:
1. The original trivia question
2. The initial LLM answer attempt (with confidence and reasoning)
3. Similar past questions and answers from prior years (if any)
4. Web search results from multiple search engines

Your job is to synthesize all this evidence and give the most accurate answer possible.

CRITICAL — RE-READ THE QUESTION CAREFULLY:
These questions contain subtle traps. Before answering:
- Identify EXACTLY which character/person/thing the question asks about
- Pay close attention to who does what in the described scenario
- Trace character/actor/role chains carefully
- If the question says "first and last name", give the PERFORMING NAME
- Watch for misdirection

Return a JSON object:
{
  "answer": "your best answer (short, specific — just the answer itself)",
  "confidence": "high" | "medium" | "low",
  "sourceIdentified": "what movie/show/song/etc this is about",
  "reasoning": "brief explanation: (1) source identified, (2) which specific detail is being asked about, (3) how you arrived at the answer, (4) what evidence supports it",
  "alternateAnswers": ["other possible answers, most likely first"]
}

Return ONLY the JSON object. No markdown wrapping.`;

// ── Types ──────────────────────────────────────────────────────────────────

interface DetectedQuestion {
  hour: number;
  questionNumber: number;
  questionText: string;
  skipReason: string | null;
}

interface QuickAnswerResult {
  answer: string;
  confidence: "high" | "medium" | "low";
  sourceIdentified: string;
  reasoning: string;
  alternateAnswers: string[];
  searchQueries: string[];
}

interface SearchAnswerResult {
  answer: string;
  confidence: "high" | "medium" | "low";
  sourceIdentified: string;
  reasoning: string;
  alternateAnswers: string[];
}

// ── Service ────────────────────────────────────────────────────────────────

export class TriviaAutoSearch {
  private channelManager: ChannelManager;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private processedQuestions = new Set<string>();
  private transcriptWindow: string[] = [];
  private lastSeenId: mongoose.Types.ObjectId | null = null;
  private mainConnection: mongoose.Connection | null = null;
  private isProcessing = false;

  constructor(channelManager: ChannelManager) {
    this.channelManager = channelManager;
  }

  async start(): Promise<void> {
    const config = await loadAppConfig();
    if (!config.triviaAutoSearch.enabled) {
      logger.info("Trivia auto-search is disabled");
      return;
    }

    if (!config.triviaAutoSearch.groupId) {
      logger.warn("Trivia auto-search enabled but no groupId configured");
      return;
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      logger.warn("Trivia auto-search enabled but ANTHROPIC_API_KEY not set");
      return;
    }

    // Connect to main DB for transcript access
    this.mainConnection = mongoose.connection;

    // Wait for trivia DB
    if (triviaConnection.readyState !== 1) {
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Trivia DB connection timeout")),
            10000
          );
          triviaConnection.on("connected", () => {
            clearTimeout(timeout);
            resolve();
          });
          triviaConnection.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });
      } catch (err) {
        logger.warn(
          `Trivia DB not available, auto-search will work without past questions: ${err}`
        );
      }
    }

    // Find the latest transcript to start from
    try {
      const transcriptsCollection = this.mainConnection.db!.collection("transcripts");
      const latest = await transcriptsCollection.findOne({}, {sort: {_id: -1}});
      if (latest) {
        this.lastSeenId = latest._id as mongoose.Types.ObjectId;
        logger.info(`Trivia auto-search starting from transcript ${this.lastSeenId}`);
      }
    } catch (err) {
      logger.warn(`Could not find latest transcript: ${err}`);
    }

    this.pollInterval = setInterval(() => {
      this.poll().catch((err) => {
        logger.error(`Trivia auto-search poll error: ${err}`);
      });
    }, POLL_INTERVAL_MS);

    logger.info(
      `Trivia auto-search started (group: ${config.triviaAutoSearch.groupId}, ` +
        `allowed users: ${config.triviaAutoSearch.allowedUserIds.join(", ") || "none"})`
    );
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      logger.info("Trivia auto-search stopped");
    }
  }

  /**
   * Check if auto-search is currently enabled (re-reads config each time).
   */
  private async isEnabled(): Promise<boolean> {
    const config = await loadAppConfig();
    return config.triviaAutoSearch.enabled;
  }

  /**
   * Handle a manual question from chat. Returns true if the message was handled.
   */
  async handleChatMessage(
    content: string,
    senderExternalId: string,
    groupId: string
  ): Promise<boolean> {
    // Check if it's a !trivia command
    const match = content.match(/^!trivia\s+(.+)/is);
    if (!match) {
      return false;
    }

    const config = await loadAppConfig();
    if (!config.triviaAutoSearch.allowedUserIds.includes(senderExternalId)) {
      logger.debug(`Trivia question from non-allowed user ${senderExternalId}, ignoring`);
      return false;
    }

    const questionText = match[1].trim();
    logger.info(
      `Manual trivia question from ${senderExternalId}: ${questionText.substring(0, 80)}`
    );

    // Process in background so we don't block the message loop
    this.processManualQuestion(questionText, groupId).catch((err) => {
      logger.error(`Error processing manual trivia question: ${err}`);
    });

    return true;
  }

  // ── Transcript polling ─────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    if (!(await this.isEnabled())) {
      return;
    }

    if (!this.mainConnection?.db) {
      return;
    }

    this.isProcessing = true;
    try {
      const transcriptsCollection = this.mainConnection.db.collection("transcripts");

      const query: any = {};
      if (this.lastSeenId) {
        query._id = {$gt: this.lastSeenId};
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
        this.lastSeenId = t._id as mongoose.Types.ObjectId;
        const content = t.content as string;

        if (!content || content.trim().length < 10) {
          continue;
        }

        this.transcriptWindow.push(content);
        if (this.transcriptWindow.length > TRANSCRIPT_WINDOW_SIZE) {
          this.transcriptWindow.shift();
        }
      }

      const windowText = this.transcriptWindow.join("\n\n");
      const questions = await this.detectQuestions(windowText);

      for (const q of questions) {
        await this.processDetectedQuestion(q);
      }
    } catch (err) {
      logger.error(`Trivia auto-search poll error: ${err}`);
    } finally {
      this.isProcessing = false;
    }
  }

  // ── Question detection ─────────────────────────────────────────────────

  private async detectQuestions(windowText: string): Promise<DetectedQuestion[]> {
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
      logger.error(`Question detection error: ${err}`);
      return [];
    }
  }

  // ── Process detected question ──────────────────────────────────────────

  private async processDetectedQuestion(question: DetectedQuestion): Promise<void> {
    const key = `H${question.hour}Q${question.questionNumber}`;

    if (this.processedQuestions.has(key)) {
      return;
    }
    this.processedQuestions.add(key);

    logger.info(`[${key}] Detected: ${question.questionText.substring(0, 100)}`);

    // Save to trivia DB
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
      logger.warn(`[${key}] DB save error: ${err}`);
    }

    if (question.skipReason) {
      logger.info(`[${key}] Skipping: ${question.skipReason}`);
      await this.postToGroup(
        `*[${key}]* ${question.questionText}\n_Skipped: ${question.skipReason}_`
      );
      return;
    }

    await this.answerAndPost(key, question.questionText);
  }

  // ── Process manual question ────────────────────────────────────────────

  private async processManualQuestion(questionText: string, _groupId: string): Promise<void> {
    await this.postToGroup(`*[Manual]* Researching: ${questionText}`);
    await this.answerAndPost("Manual", questionText);
  }

  // ── Two-phase answer pipeline ──────────────────────────────────────────

  private async answerAndPost(key: string, questionText: string): Promise<void> {
    // Phase 1: Quick LLM-only answer
    logger.info(`[${key}] Phase 1: Quick LLM answer...`);
    const quickResult = await this.quickAnswer(questionText);

    if (quickResult.confidence === "high") {
      // High confidence — post immediately
      logger.info(`[${key}] High confidence: ${quickResult.answer}`);
      await this.postAnswer(key, questionText, quickResult, null);
      await this.saveAnswer(key, quickResult.answer, quickResult);
      return;
    }

    // Post what we know so far
    const cluesMessage = this.formatCluesMessage(key, questionText, quickResult);
    await this.postToGroup(cluesMessage);

    // Phase 2: Search with all 3 engines
    logger.info(`[${key}] Phase 2: Combined search...`);
    const searchResult = await this.searchAndAnswer(questionText, quickResult);

    // Post the full answer
    await this.postAnswer(key, questionText, searchResult, quickResult);
    await this.saveAnswer(key, searchResult.answer || quickResult.answer, searchResult);
  }

  // ── Phase 1: Quick LLM-only answer ────────────────────────────────────

  private async quickAnswer(questionText: string): Promise<QuickAnswerResult> {
    const defaultResult: QuickAnswerResult = {
      answer: "",
      confidence: "low",
      sourceIdentified: "",
      reasoning: "Failed to answer",
      alternateAnswers: [],
      searchQueries: [],
    };

    try {
      const response = await anthropic.messages.create({
        model: ANSWERER_MODEL,
        max_tokens: 1024,
        system: QUICK_ANSWER_SYSTEM_PROMPT,
        messages: [{role: "user", content: questionText}],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return defaultResult;
      }

      return {...defaultResult, ...JSON.parse(jsonMatch[0])};
    } catch (err) {
      logger.error(`Quick answer error: ${err}`);
      return defaultResult;
    }
  }

  // ── Phase 2: Combined search + synthesis ──────────────────────────────

  private async searchAndAnswer(
    questionText: string,
    quickResult: QuickAnswerResult
  ): Promise<SearchAnswerResult> {
    const defaultResult: SearchAnswerResult = {
      answer: quickResult.answer,
      confidence: quickResult.confidence,
      sourceIdentified: quickResult.sourceIdentified,
      reasoning: quickResult.reasoning,
      alternateAnswers: quickResult.alternateAnswers,
    };

    // Build search queries from the quick answer's suggestions + direct question
    const queries = [...quickResult.searchQueries.slice(0, 3)];
    const directQuery = questionText
      .replace(/what is the|who is the|what are the/gi, "")
      .substring(0, 200)
      .trim();
    if (directQuery.length > 20) {
      queries.push(directQuery);
    }

    // Run searches in parallel using all 3 engines
    const allSearchResults: string[] = [];
    for (const query of queries) {
      logger.info(`  Searching: "${query}"`);
      try {
        const results = await combinedSearch(query, {count: 3});
        if (results.length > 0) {
          allSearchResults.push(`Search: "${query}"\n${formatSearchResults(results)}`);
        }
      } catch (err) {
        logger.warn(`Search error for "${query}": ${err}`);
      }
    }

    // Also search past questions
    const pastQuestions = await this.findSimilarPastQuestions(questionText);

    // Build context for the synthesis prompt
    const contextParts = [
      `ORIGINAL QUESTION:\n${questionText}`,
      "",
      `INITIAL LLM ANSWER:\n- Answer: ${quickResult.answer}\n- Confidence: ${quickResult.confidence}\n- Source: ${quickResult.sourceIdentified}\n- Reasoning: ${quickResult.reasoning}`,
    ];

    if (quickResult.alternateAnswers.length > 0) {
      contextParts.push(`- Alternates: ${quickResult.alternateAnswers.join(", ")}`);
    }

    if (pastQuestions) {
      contextParts.push("", pastQuestions);
    }

    if (allSearchResults.length > 0) {
      contextParts.push("", `WEB SEARCH RESULTS:\n\n${allSearchResults.join("\n\n---\n\n")}`);
    }

    const userMessage = contextParts.join("\n");

    try {
      const response = await anthropic.messages.create({
        model: ANSWERER_MODEL,
        max_tokens: 1024,
        system: SEARCH_ANSWER_SYSTEM_PROMPT,
        messages: [{role: "user", content: userMessage}],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return defaultResult;
      }

      return {...defaultResult, ...JSON.parse(jsonMatch[0])};
    } catch (err) {
      logger.error(`Search answer synthesis error: ${err}`);
      return defaultResult;
    }
  }

  // ── Past question lookup ──────────────────────────────────────────────

  private async findSimilarPastQuestions(questionText: string): Promise<string> {
    if (triviaConnection.readyState !== 1) {
      return "";
    }

    try {
      const currentYear = new Date().getFullYear();
      const words = questionText
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 4);

      if (words.length === 0) {
        return "";
      }

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
      logger.warn(`Past question lookup error: ${err}`);
      return "";
    }
  }

  // ── Message formatting ────────────────────────────────────────────────

  private formatCluesMessage(key: string, questionText: string, result: QuickAnswerResult): string {
    const parts = [`*[${key}]* ${questionText}`];

    if (result.sourceIdentified) {
      parts.push(`Source: ${result.sourceIdentified}`);
    }

    if (result.answer) {
      parts.push(`Best guess (${result.confidence}): *${result.answer}*`);
    }

    if (result.alternateAnswers.length > 0) {
      parts.push(`Alternates: ${result.alternateAnswers.join(", ")}`);
    }

    parts.push(`Reasoning: ${result.reasoning}`);
    parts.push("_Searching for more info..._");

    return parts.join("\n");
  }

  private async postAnswer(
    key: string,
    _questionText: string,
    result: SearchAnswerResult | QuickAnswerResult,
    quickResult: QuickAnswerResult | null
  ): Promise<void> {
    const confidenceEmoji =
      result.confidence === "high"
        ? ":white_check_mark:"
        : result.confidence === "medium"
          ? ":thinking_face:"
          : ":question:";

    const parts = [
      `${confidenceEmoji} *[${key}]* Answer: *${result.answer || "Unknown"}* (${result.confidence})`,
    ];

    if (result.sourceIdentified) {
      parts.push(`Source: ${result.sourceIdentified}`);
    }

    parts.push(`Reasoning: ${result.reasoning}`);

    if (result.alternateAnswers.length > 0) {
      parts.push(`Alternates: ${result.alternateAnswers.join(", ")}`);
    }

    // If we had a quick answer that differs from the search answer, note it
    if (quickResult?.answer && quickResult.answer !== result.answer) {
      parts.push(`_LLM first guess was: ${quickResult.answer} (${quickResult.confidence})_`);
    }

    await this.postToGroup(parts.join("\n"));
  }

  // ── Post to configured group ──────────────────────────────────────────

  private async postToGroup(content: string): Promise<void> {
    const config = await loadAppConfig();
    const groupId = config.triviaAutoSearch.groupId;
    if (!groupId) {
      logger.warn("No trivia group configured, cannot post");
      return;
    }

    try {
      await this.channelManager.sendMessageToGroup(groupId, content);
    } catch (err) {
      logger.error(`Failed to post trivia message: ${err}`);
    }
  }

  // ── Save answer to DB ─────────────────────────────────────────────────

  private async saveAnswer(
    key: string,
    answer: string,
    result: SearchAnswerResult | QuickAnswerResult
  ): Promise<void> {
    if (key === "Manual") {
      return;
    }

    const match = key.match(/H(\d+)Q(\d+)/);
    if (!match) {
      return;
    }

    const year = new Date().getFullYear();
    const hour = parseInt(match[1], 10);
    const questionNumber = parseInt(match[2], 10);

    try {
      await TriviaQuestion.findOneAndUpdate(
        {year, hour, questionNumber},
        {
          answer: answer || "",
          reasoning: [
            `Confidence: ${result.confidence}`,
            `Source: ${result.sourceIdentified}`,
            result.reasoning,
            result.alternateAnswers.length > 0
              ? `Alternates: ${result.alternateAnswers.join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
        }
      );
    } catch (err) {
      logger.warn(`[${key}] DB answer save error: ${err}`);
    }
  }
}
