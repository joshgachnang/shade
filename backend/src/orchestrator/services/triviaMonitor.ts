/**
 * Unified Trivia service. Merges the former TriviaAutoSearch and TriviaMonitor
 * into a single class so the radio-trivia pipeline has exactly one place to
 * live.
 *
 * Pipeline:
 *   1. Poll new Transcripts from the radio stream every few seconds.
 *   2. Run a rolling window through Claude Haiku to detect questions +
 *      answers (with `skipReason` flagging picture/sing/packaging/local
 *      questions that can't be researched).
 *   3. Stage detected questions in a pending queue. Audio chunking can make
 *      a partial read look complete, so we DON'T finalize until a
 *      [MUSIC_START] sentinel arrives in the Transcript stream (emitted by
 *      radioTranscriber when ACRCloud detects music).
 *   4. On music start, for each pending question: save to DB, post to group
 *      + questionsWebhook, then research.
 *   5. Research uses a Claude Sonnet tool-use loop with two tools:
 *      - web_search (Anthropic-hosted)
 *      - combined_search (Brave + Exa + Tavily via utils/search)
 *      The system prompt is AppConfig.triviaResearchSystemPrompt (with a
 *      compile-time fallback). Similar past questions from prior years are
 *      injected into the user message if present.
 *   6. When the DJ reads an official answer, save + post to answersWebhook.
 *
 * Also handles `!trivia` chat commands from allowed users (on/off/status/
 * <question>). Manual questions skip the music gate and run straight through
 * research.
 */

import Anthropic from "@anthropic-ai/sdk";
import {logger} from "@terreno/api";
import mongoose from "mongoose";
import {AppConfig, loadAppConfig, reloadAppConfig} from "../../models/appConfig";
import {TriviaQuestion, triviaConnection} from "../../models/triviaQuestion";
import {combinedSearch, formatSearchResults} from "../../utils/search";
import type {ChannelManager} from "../channels/manager";
import {
  MUSIC_END_SENTINEL,
  MUSIC_START_SENTINEL,
  TRIVIA_ANSWERER_PROMPT,
  TRIVIA_DETECTOR_PROMPT,
} from "./trivia/prompts";

const DEFAULT_DETECTOR_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_ANSWERER_MODEL = "claude-sonnet-4-20250514";
const POLL_INTERVAL_MS = 3000;
const TRANSCRIPT_WINDOW_SIZE = 25;
const RESEARCH_MAX_TURNS = 8;
/**
 * Safety net: if a question has been pending this long (measured from when
 * we first saw it in the transcript) without a [MUSIC_START] sentinel,
 * finalize it anyway. Protects against ACRCloud being down/misconfigured,
 * or any case where the DJ doesn't go to music right after the read.
 */
const PENDING_MAX_AGE_MS = 60 * 1000;

// Resolve at call time so AppConfig-hydrated env vars take effect even though
// this module is imported before server.ts calls hydrateEnvFromConfig().
const getDetectorModel = (): string => process.env.DETECTOR_MODEL || DEFAULT_DETECTOR_MODEL;
const getAnswererModel = (): string => process.env.ANSWERER_MODEL || DEFAULT_ANSWERER_MODEL;

// Lazy Anthropic client — construction reads ANTHROPIC_API_KEY synchronously,
// but the key is hydrated from AppConfig after module load.
let anthropicClient: Anthropic | null = null;
const getAnthropic = (): Anthropic => {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({apiKey: process.env.ANTHROPIC_API_KEY});
  }
  return anthropicClient;
};

interface DetectedQuestion {
  hour: number;
  questionNumber: number;
  questionText: string;
  /**
   * One of "picture" | "sing" | "packaging" | "local" | null. When set,
   * research is skipped — the question can't be answered remotely.
   */
  skipReason: string | null;
}

/**
 * Cheap local pre-check: phrases that reliably indicate an unsolvable
 * question (physical booklet, in-person, etc.). Matching here lets us bail
 * without spending Sonnet + web-search tokens on research. The Haiku
 * detector also sets skipReason, but this belt-and-suspenders catch saves
 * tokens when Haiku misses it.
 */
const LOCAL_SKIP_PATTERNS: Array<{pattern: RegExp; reason: string}> = [
  {pattern: /new trivia times/i, reason: "picture"},
  {pattern: /picture page/i, reason: "picture"},
  {pattern: /trivia stone/i, reason: "local"},
];

const localSkipReason = (text: string): string | null => {
  for (const {pattern, reason} of LOCAL_SKIP_PATTERNS) {
    if (pattern.test(text)) {
      return reason;
    }
  }
  return null;
};

interface DetectedAnswer {
  hour: number;
  questionNumber: number;
  answer: string;
}

interface DetectionResult {
  questions: DetectedQuestion[];
  answers: DetectedAnswer[];
}

interface ResearchResult {
  answer: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  category: string;
  sourceMaterial: string;
  reasoning: string;
  alternateAnswers: string;
}

export class TriviaMonitor {
  private channelManager: ChannelManager;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  /** Keys finalized (posted + researched). */
  private postedQuestions = new Set<string>();
  private postedAnswers = new Set<string>();
  /**
   * Questions detected but not yet finalized. Held here until a
   * [MUSIC_START] sentinel arrives — the DJ going to music is the signal the
   * read is actually done. Tracks first-seen timestamp so the safety-net
   * timeout can force-finalize if music never plays.
   */
  private pendingQuestions = new Map<string, {q: DetectedQuestion; firstSeen: number}>();
  private transcriptWindow: string[] = [];
  private lastSeenId: mongoose.Types.ObjectId | null = null;
  private mainConnection: mongoose.Connection | null = null;
  private isProcessing = false;

  constructor(channelManager: ChannelManager) {
    this.channelManager = channelManager;
  }

  async start(): Promise<void> {
    const config = await loadAppConfig();
    if (!config.triviaMonitor.enabled) {
      logger.debug("Trivia monitor is disabled");
      return;
    }

    if (!config.triviaMonitor.groupId) {
      logger.info("Trivia monitor: no groupId configured, using webhooks only");
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      logger.warn("Trivia monitor enabled but ANTHROPIC_API_KEY not set");
      return;
    }

    this.mainConnection = mongoose.connection;

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
        logger.warn(`Trivia DB not available, monitor will work without past-question lookup: ${err}`);
      }
    }

    try {
      const transcriptsCollection = this.mainConnection.db!.collection("transcripts");
      const latest = await transcriptsCollection.findOne({}, {sort: {_id: -1}});
      if (latest) {
        this.lastSeenId = latest._id as mongoose.Types.ObjectId;
        logger.info(`Trivia monitor starting from transcript ${this.lastSeenId}`);
      }
    } catch (err) {
      logger.warn(`Could not find latest transcript: ${err}`);
    }

    this.pollInterval = setInterval(() => {
      this.poll().catch((err) => {
        logger.error(`Trivia monitor poll error: ${err}`);
      });
    }, POLL_INTERVAL_MS);

    logger.info(
      `Trivia monitor started (group: ${config.triviaMonitor.groupId || "<none>"}, ` +
        `allowed users: ${config.triviaMonitor.allowedUserIds.join(", ") || "none"})`
    );
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      logger.info("Trivia monitor stopped");
    }
  }

  private async isEnabled(): Promise<boolean> {
    const config = await loadAppConfig();
    return config.triviaMonitor.enabled;
  }

  // ── Chat command handling ─────────────────────────────────────────────

  /**
   * Handle a `!trivia <subcommand>` chat message. Returns true if handled.
   * Subcommands: on / off / status / <question text>. Manual questions bypass
   * the music gate and go straight to research.
   */
  async handleChatMessage(
    content: string,
    senderExternalId: string,
    _groupId: string
  ): Promise<boolean> {
    const match = content.match(/^!trivia\s+(.+)/is);
    if (!match) {
      return false;
    }

    const config = await loadAppConfig();
    if (!config.triviaMonitor.allowedUserIds.includes(senderExternalId)) {
      logger.debug(`Trivia command from non-allowed user ${senderExternalId}, ignoring`);
      return false;
    }

    const raw = match[1].trim();
    const subcommand = raw.toLowerCase();

    if (subcommand === "on" || subcommand === "off") {
      const enabled = subcommand === "on";
      await AppConfig.findOneAndUpdate({}, {$set: {"triviaMonitor.enabled": enabled}});
      await reloadAppConfig();

      if (enabled) {
        await this.start();
      } else {
        this.stop();
      }

      logger.info(`Trivia monitor ${enabled ? "enabled" : "disabled"} by ${senderExternalId}`);
      await this.postToGroup(`Trivia monitor *${enabled ? "enabled" : "disabled"}*`);
      return true;
    }

    if (subcommand === "status") {
      const currentConfig = await loadAppConfig();
      const enabled = currentConfig.triviaMonitor.enabled;
      const running = this.pollInterval !== null;
      await this.postToGroup(
        `Trivia monitor: *${enabled ? "enabled" : "disabled"}* | ` +
          `Polling: *${running ? "active" : "stopped"}* | ` +
          `Pending: ${this.pendingQuestions.size}`
      );
      return true;
    }

    logger.info(
      `Manual trivia question from ${senderExternalId}: ${raw.substring(0, 100)}`
    );
    this.processManualQuestion(raw).catch((err) => {
      logger.error(`Manual trivia question error: ${err}`);
    });
    return true;
  }

  private async processManualQuestion(questionText: string): Promise<void> {
    const key = "Manual";
    await this.postToGroup(`*[Manual]* Researching: ${questionText}`);
    const q: DetectedQuestion = {
      hour: 0,
      questionNumber: 0,
      questionText,
      skipReason: null,
    };
    await this.researchQuestion(key, q, {persist: false});
  }

  // ── Transcript polling ────────────────────────────────────────────────

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

      let musicStarted = false;
      for (const t of newTranscripts) {
        this.lastSeenId = t._id as mongoose.Types.ObjectId;
        const content = (t.content as string | undefined)?.trim() ?? "";

        if (content === MUSIC_START_SENTINEL) {
          musicStarted = true;
          continue;
        }
        if (content === MUSIC_END_SENTINEL) {
          continue;
        }
        if (content.length < 10) {
          continue;
        }

        this.transcriptWindow.push(content);
        if (this.transcriptWindow.length > TRANSCRIPT_WINDOW_SIZE) {
          this.transcriptWindow.shift();
        }
      }

      const windowText = this.transcriptWindow.join("\n\n");
      const result = await this.detect(windowText);

      for (const q of result.questions) {
        this.handleQuestion(q);
      }

      for (const a of result.answers) {
        await this.handleAnswer(a);
      }

      if (musicStarted) {
        await this.finalizePendingQuestions("music");
      } else {
        // Safety net: force-finalize anything that's been pending longer than
        // PENDING_MAX_AGE_MS even without a music sentinel.
        await this.finalizePendingQuestions("timeout");
      }
    } catch (err) {
      logger.error(`Trivia monitor poll error: ${err}`);
    } finally {
      this.isProcessing = false;
    }
  }

  // ── Detection ────────────────────────────────────────────────────────

  private async detect(windowText: string): Promise<DetectionResult> {
    try {
      const response = await getAnthropic().messages.create({
        model: getDetectorModel(),
        max_tokens: 2048,
        system: TRIVIA_DETECTOR_PROMPT,
        messages: [{role: "user", content: windowText}],
      });

      const text = response.content[0]?.type === "text" ? response.content[0].text : "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {questions: [], answers: []};
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        questions: (parsed.questions || []).filter(
          (q: any) =>
            typeof q.hour === "number" &&
            typeof q.questionNumber === "number" &&
            typeof q.questionText === "string" &&
            q.hour >= 1 &&
            q.hour <= 54 &&
            q.questionNumber >= 1 &&
            q.questionNumber <= 12
        ).map((q: any) => ({
          hour: q.hour,
          questionNumber: q.questionNumber,
          questionText: q.questionText,
          skipReason: typeof q.skipReason === "string" && q.skipReason.trim() ? q.skipReason.trim() : null,
        })),
        answers: (parsed.answers || []).filter(
          (a: any) =>
            typeof a.hour === "number" &&
            typeof a.questionNumber === "number" &&
            typeof a.answer === "string" &&
            a.hour >= 1 &&
            a.hour <= 54 &&
            a.questionNumber >= 1 &&
            a.questionNumber <= 12
        ),
      };
    } catch (err) {
      logger.error(`Trivia monitor detection error: ${err}`);
      return {questions: [], answers: []};
    }
  }

  // ── Pending question handling ─────────────────────────────────────────

  private handleQuestion(q: DetectedQuestion): void {
    const key = `H${q.hour}Q${q.questionNumber}`;
    if (this.postedQuestions.has(key)) {
      return;
    }

    // Augment skipReason with a cheap local check so we bail before research
    // on phrases that always indicate an unsolvable question.
    if (!q.skipReason) {
      const local = localSkipReason(q.questionText);
      if (local) {
        q = {...q, skipReason: local};
        logger.debug(`[TriviaMonitor] Local skip match for ${key}: ${local}`);
      }
    }

    const prev = this.pendingQuestions.get(key);
    const isNew = !prev;
    const isUpdated = prev && prev.q.questionText !== q.questionText;
    this.pendingQuestions.set(key, {q, firstSeen: prev?.firstSeen ?? Date.now()});

    if (isNew) {
      logger.info(
        `[TriviaMonitor] Pending ${key}: ${q.questionText.substring(0, 120)} (waiting for music)`
      );
    } else if (isUpdated) {
      logger.debug(`[TriviaMonitor] Pending ${key} updated (waiting for music)`);
    }
  }

  /**
   * Promote pending questions to posted + research. `trigger === "music"`
   * finalizes everything (DJ stopped talking). `trigger === "timeout"` only
   * finalizes entries older than PENDING_MAX_AGE_MS — the safety net for
   * when music detection fails or is delayed.
   */
  private async finalizePendingQuestions(
    trigger: "music" | "timeout" = "music"
  ): Promise<void> {
    if (this.pendingQuestions.size === 0) {
      return;
    }

    const now = Date.now();
    const toFinalize: DetectedQuestion[] = [];
    for (const [key, entry] of this.pendingQuestions) {
      if (trigger === "music") {
        toFinalize.push(entry.q);
        this.pendingQuestions.delete(key);
      } else if (now - entry.firstSeen >= PENDING_MAX_AGE_MS) {
        toFinalize.push(entry.q);
        this.pendingQuestions.delete(key);
      }
    }

    if (toFinalize.length === 0) {
      return;
    }

    if (trigger === "music") {
      logger.info(
        `[TriviaMonitor] Music started — finalizing ${toFinalize.length} pending question(s)`
      );
    } else {
      logger.warn(
        `[TriviaMonitor] Pending timeout (${PENDING_MAX_AGE_MS}ms) — force-finalizing ` +
          `${toFinalize.length} question(s) without music signal ` +
          `(check ACRCloud keys / songIdentification flag)`
      );
    }

    for (const q of toFinalize) {
      const key = `H${q.hour}Q${q.questionNumber}`;
      if (this.postedQuestions.has(key)) {
        continue;
      }
      this.postedQuestions.add(key);

      logger.info(`[TriviaMonitor] Question ${key}: ${q.questionText.substring(0, 120)}`);

      const year = new Date().getFullYear();
      try {
        await TriviaQuestion.findOneAndUpdate(
          {year, hour: q.hour, questionNumber: q.questionNumber},
          {year, hour: q.hour, questionNumber: q.questionNumber, questionText: q.questionText},
          {upsert: true, new: true}
        );
        logger.debug(`[TriviaMonitor] Saved question for ${key} to DB`);
      } catch (err) {
        logger.warn(`[TriviaMonitor] DB save error for ${key}: ${err}`);
      }

      const questionMsg = `*[${key}]* Question ${q.questionNumber}, Hour ${q.hour}:\n${q.questionText}`;
      await this.postToGroup(questionMsg);
      await this.postToWebhook("questions", questionMsg);

      if (q.skipReason) {
        const skipMsg = `:no_entry_sign: *[${key}]* Skipping research — ${q.skipReason} question`;
        logger.info(`[TriviaMonitor] Skipping research for ${key}: ${q.skipReason}`);
        await this.postToGroup(skipMsg);
        await this.postToWebhook("answers", skipMsg);
        continue;
      }

      this.researchQuestion(key, q).catch((err) => {
        logger.error(`[TriviaMonitor] Research error for ${key}: ${err}`);
      });
    }
  }

  // ── Answer handling (DJ-read official answers) ───────────────────────

  private async handleAnswer(a: DetectedAnswer): Promise<void> {
    const key = `H${a.hour}Q${a.questionNumber}`;
    if (this.postedAnswers.has(key)) {
      return;
    }
    this.postedAnswers.add(key);

    logger.info(`[TriviaMonitor] Answer ${key}: ${a.answer}`);

    const year = new Date().getFullYear();
    try {
      await TriviaQuestion.findOneAndUpdate(
        {year, hour: a.hour, questionNumber: a.questionNumber},
        {
          $set: {
            answer: a.answer,
            reasoning: "Official answer from broadcast",
          },
          $setOnInsert: {
            year,
            hour: a.hour,
            questionNumber: a.questionNumber,
            questionText: "(pending transcription)",
          },
        },
        {upsert: true, new: true}
      );
      logger.debug(`[TriviaMonitor] Saved answer for ${key} to DB`);
    } catch (err) {
      logger.warn(`[TriviaMonitor] DB answer save error for ${key}: ${err}`);
    }

    const message = `*[${key}]* Official Answer to Q${a.questionNumber}, Hour ${a.hour}: *${a.answer}*`;
    await this.postToGroup(message);
    await this.postToWebhook("answers", message);
  }

  // ── Research ─────────────────────────────────────────────────────────

  private async researchQuestion(
    key: string,
    q: DetectedQuestion,
    opts: {persist?: boolean} = {}
  ): Promise<void> {
    const persist = opts.persist !== false;
    const questionHeader =
      key === "Manual"
        ? `Manual question:\n\n${q.questionText}`
        : `Question ${q.questionNumber}, Hour ${q.hour}:\n\n${q.questionText}`;

    const pastContext = await this.findSimilarPastQuestions(q.questionText);
    const userPrompt = pastContext
      ? `${questionHeader}\n\n---\n\n${pastContext}`
      : questionHeader;

    logger.info(
      `[TriviaMonitor] Researching ${key}. Prompt to Claude:\n---\n${userPrompt}\n---`
    );

    const config = await loadAppConfig();
    const systemPrompt = config.triviaResearchSystemPrompt?.trim() || TRIVIA_ANSWERER_PROMPT;

    try {
      const fullText = await this.runResearchLoop(key, userPrompt, systemPrompt);
      if (!fullText) {
        logger.warn(`[TriviaMonitor] Empty research response for ${key}`);
        return;
      }

      const result = this.parseResearchResponse(fullText);
      logger.info(
        `[TriviaMonitor] Research ${key}: ${result.confidence} confidence — ${result.answer}`
      );

      if (persist && key !== "Manual") {
        const year = new Date().getFullYear();
        const reasoning = [
          `Confidence: ${result.confidence}`,
          `Category: ${result.category}`,
          `Source: ${result.sourceMaterial}`,
          result.reasoning,
          result.alternateAnswers ? `Alternates: ${result.alternateAnswers}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        try {
          await TriviaQuestion.findOneAndUpdate(
            {year, hour: q.hour, questionNumber: q.questionNumber},
            {
              $set: {reasoning},
              $setOnInsert: {
                year,
                hour: q.hour,
                questionNumber: q.questionNumber,
                questionText: q.questionText,
              },
            },
            {upsert: true, new: true}
          );
          logger.debug(`[TriviaMonitor] Saved research for ${key} to DB`);
        } catch (err) {
          logger.warn(`[TriviaMonitor] DB research save error for ${key}: ${err}`);
        }
      }

      const confidenceEmoji =
        result.confidence === "HIGH"
          ? ":white_check_mark:"
          : result.confidence === "MEDIUM"
            ? ":thinking_face:"
            : ":question:";
      const headline =
        key === "Manual"
          ? `${confidenceEmoji} *[Manual]* Answer (${result.confidence}): *${result.answer || "No confident answer"}*`
          : `${confidenceEmoji} *[${key}]* Researched Answer (${result.confidence}): *${result.answer || "No confident answer"}*`;

      const parts = [headline];
      if (result.sourceMaterial) {
        parts.push(`Source: ${result.sourceMaterial}`);
      }
      if (result.reasoning) {
        parts.push(`Reasoning: ${result.reasoning}`);
      }
      if (result.alternateAnswers) {
        parts.push(`Alternates: ${result.alternateAnswers}`);
      }

      const message = parts.join("\n");
      await this.postToGroup(message);

      await this.postToWebhook("answers", message);
    } catch (err) {
      logger.error(`[TriviaMonitor] Research API error for ${key}: ${err}`);
    }
  }

  /**
   * Claude tool-use loop. Tools: Anthropic-hosted `web_search_20250305` and
   * our custom `combined_search` (Brave + Exa + Tavily in parallel).
   */
  private async runResearchLoop(
    key: string,
    userPrompt: string,
    systemPrompt: string
  ): Promise<string> {
    const tools: Anthropic.Messages.ToolUnion[] = [
      {type: "web_search_20250305", name: "web_search", max_uses: 5},
      {
        name: "combined_search",
        description:
          "Search the web across Brave, Exa, and Tavily in parallel and return deduplicated results. Prefer this for most queries — it gives broader coverage than a single provider. Returns an array of {title, url, description} entries.",
        input_schema: {
          type: "object",
          properties: {
            query: {type: "string", description: "The search query"},
            count: {
              type: "number",
              description: "Max results per provider (default 5)",
            },
          },
          required: ["query"],
        },
      },
    ];

    const messages: Anthropic.Messages.MessageParam[] = [
      {role: "user", content: userPrompt},
    ];

    let finalText = "";

    for (let turn = 0; turn < RESEARCH_MAX_TURNS; turn++) {
      const response = await getAnthropic().messages.create({
        model: getAnswererModel(),
        max_tokens: 4096,
        system: systemPrompt,
        tools,
        messages,
      });

      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      if (textBlocks.length > 0) {
        finalText = textBlocks.map((b) => b.text).join("\n");
      }

      if (response.stop_reason !== "tool_use") {
        return finalText;
      }

      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );
      if (toolUses.length === 0) {
        return finalText;
      }

      messages.push({role: "assistant", content: response.content});

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const resultText = await this.executeToolCall(key, use);
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: resultText,
        });
      }

      messages.push({role: "user", content: toolResults});
    }

    logger.warn(`[TriviaMonitor] Research ${key} hit MAX_TURNS (${RESEARCH_MAX_TURNS})`);
    return finalText;
  }

  private async executeToolCall(
    key: string,
    use: Anthropic.ToolUseBlock
  ): Promise<string> {
    if (use.name === "combined_search") {
      const input = (use.input ?? {}) as {query?: string; count?: number};
      const query = (input.query ?? "").toString();
      if (!query) {
        return "Error: missing query";
      }
      logger.info(`[TriviaMonitor] ${key} combined_search("${query}")`);
      try {
        const results = await combinedSearch(query, {count: input.count ?? 5});
        return formatSearchResults(results);
      } catch (err) {
        logger.warn(`[TriviaMonitor] combined_search failed for ${key}: ${err}`);
        return `Error executing combined_search: ${err}`;
      }
    }
    logger.warn(`[TriviaMonitor] Unknown tool call from Claude: ${use.name}`);
    return `Error: unknown tool ${use.name}`;
  }

  private parseResearchResponse(text: string): ResearchResult {
    const extract = (label: string): string => {
      const regex = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+?)(?=\\n\\*\\*|$)`, "s");
      const match = text.match(regex);
      return match ? match[1].trim() : "";
    };

    return {
      answer: extract("ANSWER"),
      confidence: (extract("CONFIDENCE").toUpperCase() as ResearchResult["confidence"]) || "LOW",
      category: extract("CATEGORY"),
      sourceMaterial: extract("SOURCE MATERIAL"),
      reasoning: extract("REASONING"),
      alternateAnswers: extract("ALTERNATIVE ANSWERS"),
    };
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
      logger.warn(`[TriviaMonitor] Past question lookup error: ${err}`);
      return "";
    }
  }

  // ── Outputs ───────────────────────────────────────────────────────────

  private async postToGroup(content: string): Promise<void> {
    const config = await loadAppConfig();
    const groupId = config.triviaMonitor.groupId;
    if (!groupId) {
      return;
    }

    try {
      await this.channelManager.sendMessageToGroup(groupId, content);
    } catch (err) {
      logger.error(`[TriviaMonitor] Failed to post message: ${err}`);
    }
  }

  private async postToWebhook(type: "questions" | "answers", text: string): Promise<void> {
    const config = await loadAppConfig();
    const url =
      type === "questions"
        ? config.triviaMonitor.questionsWebhook
        : config.triviaMonitor.answersWebhook;

    if (!url) {
      logger.debug(
        `[TriviaMonitor] No ${type} webhook configured (triviaMonitor.${type}Webhook) — skipping post`
      );
      return;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({text}),
      });

      if (!response.ok) {
        logger.warn(
          `[TriviaMonitor] Webhook POST failed (${type}): ${response.status} ${response.statusText}`
        );
      } else {
        logger.debug(`[TriviaMonitor] Posted to ${type} webhook`);
      }
    } catch (err) {
      logger.error(`[TriviaMonitor] Webhook error (${type}): ${err}`);
    }
  }
}
