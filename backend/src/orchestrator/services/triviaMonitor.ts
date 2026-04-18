/**
 * Trivia Monitor service.
 *
 * Watches transcripts for trivia questions and answers as they're read on air.
 * Posts each question once when detected, and each answer once when the DJ reads it.
 * Saves both to the TriviaQuestion DB.
 *
 * Controlled via AppConfig.triviaMonitor.enabled / .groupId.
 */

import Anthropic from "@anthropic-ai/sdk";
import {logger} from "@terreno/api";
import mongoose from "mongoose";
import {loadAppConfig} from "../../models/appConfig";
import {TriviaQuestion, triviaConnection} from "../../models/triviaQuestion";
import type {ChannelManager} from "../channels/manager";

const DETECTOR_MODEL = process.env.DETECTOR_MODEL || "claude-haiku-4-5-20251001";
const POLL_INTERVAL_MS = 3000;
const TRANSCRIPT_WINDOW_SIZE = 25;

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `You are a trivia question and answer detector for the WWSP 90FM Trivia contest broadcast.

You receive a rolling window of transcribed radio text. Your job is to detect trivia questions being read AND answers being given.

TRANSCRIPTION PATTERNS:
- "our nine" or "our 9" = "hour 9" (the word "hour" is almost always transcribed as "our" or "are")
- "question number one of our nine" = question 1 of hour 9
- "question won" = "question one"
- Numbers may be spelled out: "twenty three" = 23
- Questions are always read TWICE: "question 1, hour 2: <question text>... again, question 1, hour 2: <question text>"
- Answers follow the pattern: "the answer to question X, hour Y is <answer>, again <answer>"

WHAT TO DETECT:

1. QUESTIONS: When the DJ reads a trivia question (they read it twice). Extract the full question text. A question is complete when you can see it has been read at least once with the full text.

2. ANSWERS: When the DJ announces the answer to a question. The format is typically "the answer to question X of hour Y is <answer>, again <answer>".

Return a JSON object:
{
  "questions": [
    {
      "hour": number (1-54),
      "questionNumber": number (1-12),
      "questionText": "the cleaned up question text"
    }
  ],
  "answers": [
    {
      "hour": number (1-54),
      "questionNumber": number (1-12),
      "answer": "the answer given"
    }
  ]
}

RULES:
- Only include questions/answers you are confident about
- Clean up transcription artifacts in the question text
- For answers, extract just the answer itself (short, 1-4 words typically)
- Ignore: banter, ads, music, news, station IDs, score updates, song dedications
- If nothing detected, return {"questions": [], "answers": []}

Return ONLY the JSON object. No markdown, no explanation.`;

interface DetectedQuestion {
  hour: number;
  questionNumber: number;
  questionText: string;
}

interface DetectedAnswer {
  hour: number;
  questionNumber: number;
  answer: string;
}

interface DetectionResult {
  questions: DetectedQuestion[];
  answers: DetectedAnswer[];
}

export class TriviaMonitor {
  private channelManager: ChannelManager;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private postedQuestions = new Set<string>();
  private postedAnswers = new Set<string>();
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
      logger.info("Trivia monitor is disabled");
      return;
    }

    if (!config.triviaMonitor.groupId) {
      logger.warn("Trivia monitor enabled but no groupId configured");
      return;
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      logger.warn("Trivia monitor enabled but ANTHROPIC_API_KEY not set");
      return;
    }

    this.mainConnection = mongoose.connection;

    // Wait for trivia DB connection
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
        logger.warn(`Trivia DB not available, monitor will work without saving: ${err}`);
      }
    }

    // Start from the latest transcript
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

    logger.info(`Trivia monitor started (group: ${config.triviaMonitor.groupId})`);
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
      const result = await this.detect(windowText);

      for (const q of result.questions) {
        await this.handleQuestion(q);
      }

      for (const a of result.answers) {
        await this.handleAnswer(a);
      }
    } catch (err) {
      logger.error(`Trivia monitor poll error: ${err}`);
    } finally {
      this.isProcessing = false;
    }
  }

  // ── Detection ──────────────────────────────────────────────────────────

  private async detect(windowText: string): Promise<DetectionResult> {
    try {
      const response = await anthropic.messages.create({
        model: DETECTOR_MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{role: "user", content: windowText}],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
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
        ),
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

  // ── Handle detected question ───────────────────────────────────────────

  private async handleQuestion(q: DetectedQuestion): Promise<void> {
    const key = `H${q.hour}Q${q.questionNumber}`;
    if (this.postedQuestions.has(key)) {
      return;
    }
    this.postedQuestions.add(key);

    logger.info(`[TriviaMonitor] Question ${key}: ${q.questionText.substring(0, 100)}`);

    // Save to DB
    const year = new Date().getFullYear();
    try {
      await TriviaQuestion.findOneAndUpdate(
        {year, hour: q.hour, questionNumber: q.questionNumber},
        {
          year,
          hour: q.hour,
          questionNumber: q.questionNumber,
          questionText: q.questionText,
        },
        {upsert: true, new: true}
      );
    } catch (err) {
      logger.warn(`[TriviaMonitor] DB save error for ${key}: ${err}`);
    }

    // Post to group and webhook
    const message = `*[${key}]* Question ${q.questionNumber}, Hour ${q.hour}:\n${q.questionText}`;
    await this.postToGroup(message);
    await this.postToWebhook("questions", message);
  }

  // ── Handle detected answer ─────────────────────────────────────────────

  private async handleAnswer(a: DetectedAnswer): Promise<void> {
    const key = `H${a.hour}Q${a.questionNumber}`;
    if (this.postedAnswers.has(key)) {
      return;
    }
    this.postedAnswers.add(key);

    logger.info(`[TriviaMonitor] Answer ${key}: ${a.answer}`);

    // Save to DB
    const year = new Date().getFullYear();
    try {
      await TriviaQuestion.findOneAndUpdate(
        {year, hour: a.hour, questionNumber: a.questionNumber},
        {
          answer: a.answer,
          reasoning: "Official answer from broadcast",
        }
      );
    } catch (err) {
      logger.warn(`[TriviaMonitor] DB answer save error for ${key}: ${err}`);
    }

    // Post to group and webhook
    const message = `*[${key}]* Official Answer to Q${a.questionNumber}, Hour ${a.hour}: *${a.answer}*`;
    await this.postToGroup(message);
    await this.postToWebhook("answers", message);
  }

  // ── Post to configured group ───────────────────────────────────────────

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

  // ── Post to Slack webhook ──────────────────────────────────────────────

  private async postToWebhook(type: "questions" | "answers", text: string): Promise<void> {
    const config = await loadAppConfig();
    const url =
      type === "questions"
        ? config.triviaMonitor.questionsWebhook
        : config.triviaMonitor.answersWebhook;

    if (!url) {
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
      }
    } catch (err) {
      logger.error(`[TriviaMonitor] Webhook error (${type}): ${err}`);
    }
  }
}
