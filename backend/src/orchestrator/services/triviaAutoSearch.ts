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
import {AppConfig, loadAppConfig, reloadAppConfig} from "../../models/appConfig";
import {TriviaQuestion, triviaConnection} from "../../models/triviaQuestion";
import {combinedSearch} from "../../utils/search/combinedSearch";
import {formatSearchResults} from "../../utils/search/types";
import type {ChannelManager} from "../channels/manager";
import {
  type DetectedTriviaQuestion,
  TRIVIA_DETECTOR_SYSTEM_PROMPT,
  TRIVIA_QUICK_ANSWER_SYSTEM_PROMPT,
  TRIVIA_SEARCH_ANSWER_SYSTEM_PROMPT,
  type TriviaQuickAnswerResult,
  type TriviaSearchAnswerResult,
} from "./trivia/prompts";

const DEFAULT_ANSWERER_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_DETECTOR_MODEL = "claude-haiku-4-5-20251001";
const POLL_INTERVAL_MS = 5000;
const TRANSCRIPT_WINDOW_SIZE = 20;

// Resolve model names at call time (not module load) so AppConfig hydration
// in server.ts has a chance to populate process.env first.
const getAnswererModel = (): string => process.env.ANSWERER_MODEL || DEFAULT_ANSWERER_MODEL;
const getDetectorModel = (): string => process.env.DETECTOR_MODEL || DEFAULT_DETECTOR_MODEL;

const anthropic = new Anthropic();

// Local aliases so the rest of the file reads cleanly.
type DetectedQuestion = DetectedTriviaQuestion;
type QuickAnswerResult = TriviaQuickAnswerResult;
type SearchAnswerResult = TriviaSearchAnswerResult;

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
      logger.debug("Trivia auto-search is disabled");
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
      logger.debug(`Trivia command from non-allowed user ${senderExternalId}, ignoring`);
      return false;
    }

    const subcommand = match[1].trim().toLowerCase();

    // Handle on/off toggle
    if (subcommand === "on" || subcommand === "off") {
      const enabled = subcommand === "on";
      await AppConfig.findOneAndUpdate({}, {$set: {"triviaAutoSearch.enabled": enabled}});
      await reloadAppConfig();

      if (enabled) {
        await this.start();
      } else {
        this.stop();
      }

      logger.info(`Trivia auto-search ${enabled ? "enabled" : "disabled"} by ${senderExternalId}`);
      await this.postToGroup(`Trivia auto-search *${enabled ? "enabled" : "disabled"}*`);
      return true;
    }

    // Handle status check
    if (subcommand === "status") {
      const currentConfig = await loadAppConfig();
      const enabled = currentConfig.triviaAutoSearch.enabled;
      const running = this.pollInterval !== null;
      await this.postToGroup(
        `Trivia auto-search: *${enabled ? "enabled" : "disabled"}* | Polling: *${running ? "active" : "stopped"}*`
      );
      return true;
    }

    // Otherwise treat as a manual question
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
        model: getDetectorModel(),
        max_tokens: 2048,
        system: TRIVIA_DETECTOR_SYSTEM_PROMPT,
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
        model: getAnswererModel(),
        max_tokens: 1024,
        system: TRIVIA_QUICK_ANSWER_SYSTEM_PROMPT,
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
        model: getAnswererModel(),
        max_tokens: 1024,
        system: TRIVIA_SEARCH_ANSWER_SYSTEM_PROMPT,
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
