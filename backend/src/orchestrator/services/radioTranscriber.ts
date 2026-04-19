import type {ChildProcess} from "node:child_process";
import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {logger} from "@terreno/api";
import {paths} from "../../config";
import {RADIO_STREAM_STATUS} from "../../constants/statuses";
import {loadAppConfig} from "../../models/appConfig";
import {RadioStream} from "../../models/radioStream";
import {Transcript} from "../../models/transcript";
import type {RadioStreamDocument} from "../../types";
import {getRecordingPublicBaseUrl} from "../../utils/publicUrl";
import type {ChannelManager} from "../channels/manager";
import {MUSIC_END_SENTINEL, MUSIC_START_SENTINEL} from "./trivia/prompts";
import {queryAcrCloud} from "./radio/acrCloud";
import {pcmToMp3, wrapPcmAsWav} from "./radio/audioEncoding";
import {postMessageToSlack, sendToSlackWebhook} from "./radio/slackNotifier";

/** How often to check ACRCloud (ms) */
const SONG_ID_INTERVAL_MS = 30_000;

/** How many seconds of audio to keep in the rolling buffer for song ID */
const AUDIO_BUFFER_SECONDS = 15;

/** At 16kHz mono 16-bit PCM, each second is 32000 bytes */
const BYTES_PER_SECOND = 16000 * 2 * 1;

/** Max buffer size in bytes */
const MAX_AUDIO_BUFFER = AUDIO_BUFFER_SECONDS * BYTES_PER_SECOND;

interface SongIdState {
  lastIdentifiedSong: string | null;
  isIdentifying: boolean;
  musicPlaying: boolean;
  timer: ReturnType<typeof setInterval> | null;
}

interface ActiveStream {
  streamId: string;
  doc: RadioStreamDocument;
  ffmpegProcess: ChildProcess | null;
  ws: WebSocket | null;
  transcriptBuffer: string;
  batchStartedAt: Date;
  flushTimer: ReturnType<typeof setInterval> | null;
  stopping: boolean;
  songId: SongIdState;
  /** Rolling buffer for ACRCloud song identification */
  audioBuffer: Buffer[];
  audioBufferBytes: number;
  /** Audio collected during the current flush window, converted to MP3 and attached to Slack messages */
  flushAudioChunks: Buffer[];
}

const FFMPEG_SEARCH_PATHS = [
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
];

/**
 * ffmpeg stderr noise we always drop. These warnings are emitted for a bad
 * packet here and there in live MP3/HTTP streams — ffmpeg recovers and
 * keeps decoding, so surfacing them only pollutes the logs. Anything NOT
 * matching these patterns still goes to debug.
 */
const FFMPEG_STDERR_SILENCE_PATTERNS: RegExp[] = [
  /Error submitting packet to decoder.*Invalid data found/i,
  /Invalid data found when processing input/i,
  /mp3float.*Header missing/i,
  /past duration .* too large/i,
  /non monotonically increasing dts/i,
];

export class RadioTranscriber {
  private channelManager: ChannelManager;
  private activeStreams = new Map<string, ActiveStream>();
  private ffmpegPath = "ffmpeg";

  constructor(channelManager: ChannelManager) {
    this.channelManager = channelManager;
  }

  private findFfmpeg(): string | null {
    const {execSync} = require("node:child_process");
    // Try which first (works if PATH is set correctly)
    try {
      return execSync("which ffmpeg", {stdio: "pipe"}).toString().trim();
    } catch {
      // Fall through
    }
    // Check common paths
    const fs = require("node:fs");
    for (const p of FFMPEG_SEARCH_PATHS) {
      try {
        fs.accessSync(p, fs.constants.X_OK);
        return p;
      } catch {
        // continue
      }
    }
    return null;
  }

  async start(): Promise<void> {
    // Credential is hydrated from AppConfig.apiKeys.deepgram if not set in
    // the process environment. See utils/configEnv.ts.
    if (!process.env.DEEPGRAM_API_KEY) {
      logger.warn(
        "Deepgram API key not set (AppConfig.apiKeys.deepgram or DEEPGRAM_API_KEY) — radio transcriber disabled"
      );
      return;
    }

    const ffmpegPath = this.findFfmpeg();
    if (!ffmpegPath) {
      logger.warn("ffmpeg not found — radio transcriber disabled");
      return;
    }
    this.ffmpegPath = ffmpegPath;
    logger.info(`Using ffmpeg at: ${ffmpegPath}`);

    const streams = await RadioStream.find({status: "active", transcriptionEnabled: true});
    if (streams.length === 0) {
      logger.info("No active radio streams configured");
      return;
    }

    logger.info(`Starting ${streams.length} radio stream(s)...`);
    for (const doc of streams) {
      try {
        await this.startStream(doc);
      } catch (err) {
        logger.error(`Failed to start radio stream "${doc.name}": ${err}`);
        await RadioStream.findByIdAndUpdate(doc._id, {
          $set: {status: RADIO_STREAM_STATUS.error, errorMessage: String(err)},
        });
      }
    }
  }

  async stop(): Promise<void> {
    logger.info(`Stopping ${this.activeStreams.size} radio stream(s)...`);
    const stopPromises = [...this.activeStreams.keys()].map((id) => this.stopStream(id));
    await Promise.allSettled(stopPromises);
    logger.info("All radio streams stopped");
  }

  async startStream(doc: RadioStreamDocument): Promise<void> {
    const streamId = doc._id.toString();
    if (this.activeStreams.has(streamId)) {
      logger.warn(`Stream "${doc.name}" already active, skipping`);
      return;
    }

    logger.info(`Starting radio stream "${doc.name}" from ${doc.streamUrl}`);

    const active: ActiveStream = {
      streamId,
      doc,
      ffmpegProcess: null,
      ws: null,
      transcriptBuffer: "",
      batchStartedAt: new Date(),
      flushTimer: null,
      stopping: false,
      songId: {
        lastIdentifiedSong: null,
        isIdentifying: false,
        musicPlaying: false,
        timer: null,
      },
      audioBuffer: [],
      audioBufferBytes: 0,
      flushAudioChunks: [],
    };

    this.activeStreams.set(streamId, active);

    this.launchPipeline(active);

    // Set up periodic flush to Slack
    const appConfig = await loadAppConfig();
    const batchInterval =
      doc.transcriptBatchIntervalMs || appConfig.radioTranscriber.defaultBatchIntervalMs;
    active.flushTimer = setInterval(() => {
      this.flushTranscript(active).catch((err) => {
        logger.error(`Flush error for stream "${doc.name}": ${err}`);
      });
    }, batchInterval);

    // Set up periodic song identification via ACRCloud. Gated by
    // AppConfig.radioTranscriber.songIdentification so operators can disable
    // both the polling and the "Now Playing" Slack post.
    const songIdEnabled = appConfig.radioTranscriber.songIdentification !== false;
    if (
      songIdEnabled &&
      process.env.ACRCLOUD_ACCESS_KEY &&
      process.env.ACRCLOUD_SECRET_KEY
    ) {
      active.songId.timer = setInterval(() => {
        this.identifySong(active).catch((err) => {
          logger.error(`Song ID error for stream "${doc.name}": ${err}`);
        });
      }, SONG_ID_INTERVAL_MS);
      logger.info(
        `Song identification enabled for "${doc.name}" (every ${SONG_ID_INTERVAL_MS / 1000}s)`
      );
    } else if (!songIdEnabled) {
      logger.info(`Song identification disabled by AppConfig for "${doc.name}"`);
    }

    logger.info(`Radio stream "${doc.name}" pipeline launched (flush every ${batchInterval}ms)`);
  }

  async stopStream(streamId: string): Promise<void> {
    const active = this.activeStreams.get(streamId);
    if (!active) {
      return;
    }

    active.stopping = true;

    // Flush remaining transcript
    await this.flushTranscript(active);

    if (active.flushTimer) {
      clearInterval(active.flushTimer);
      active.flushTimer = null;
    }

    if (active.songId.timer) {
      clearInterval(active.songId.timer);
      active.songId.timer = null;
    }

    if (active.ws) {
      try {
        active.ws.close();
      } catch {
        // ignore
      }
      active.ws = null;
    }

    if (active.ffmpegProcess) {
      active.ffmpegProcess.kill("SIGTERM");
      active.ffmpegProcess = null;
    }

    this.activeStreams.delete(streamId);
    logger.info(`Stream "${active.doc.name}" stopped`);
  }

  private launchPipeline(active: ActiveStream): void {
    this.launchFfmpeg(active);
    this.launchDeepgram(active);
  }

  private launchFfmpeg(active: ActiveStream): void {
    const ffmpeg = spawn(
      this.ffmpegPath,
      [
        "-reconnect",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_delay_max",
        "30",
        "-i",
        active.doc.streamUrl,
        "-f",
        "wav",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-loglevel",
        "warning",
        "-",
      ],
      {stdio: ["ignore", "pipe", "pipe"]}
    );

    active.ffmpegProcess = ffmpeg;

    ffmpeg.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (!msg) {
        return;
      }
      if (FFMPEG_STDERR_SILENCE_PATTERNS.some((re) => re.test(msg))) {
        return;
      }
      logger.debug(`ffmpeg [${active.doc.name}]: ${msg}`);
    });

    ffmpeg.stdout?.on("data", (chunk: Buffer) => {
      if (active.ws && (active.ws as any).readyState === WebSocket.OPEN) {
        try {
          (active.ws as any).send(chunk);
        } catch (err) {
          logger.debug(`WebSocket send error for "${active.doc.name}": ${err}`);
        }
      }
      // Collect audio for the current flush window (MP3 attachment)
      active.flushAudioChunks.push(Buffer.from(chunk));
      // Keep a rolling buffer of recent audio for song identification
      active.audioBuffer.push(chunk);
      active.audioBufferBytes += chunk.length;
      while (active.audioBufferBytes > MAX_AUDIO_BUFFER) {
        const removed = active.audioBuffer.shift();
        if (removed) {
          active.audioBufferBytes -= removed.length;
        } else {
          break;
        }
      }
    });

    ffmpeg.on("close", (code) => {
      if (active.stopping) {
        return;
      }

      logger.warn(`ffmpeg exited for "${active.doc.name}" with code ${code}, scheduling reconnect`);
      active.ffmpegProcess = null;
      void this.scheduleReconnect(active, "ffmpeg");
    });

    ffmpeg.on("error", (err) => {
      logger.error(`ffmpeg error for "${active.doc.name}": ${err}`);
    });
  }

  private launchDeepgram(active: ActiveStream): void {
    const dgConfig = active.doc.deepgramConfig || {};
    const model = dgConfig.model || "nova-3";
    const language = dgConfig.language || "en";
    const smartFormat = dgConfig.smartFormat !== false;
    const punctuate = dgConfig.punctuate !== false;

    const params = new URLSearchParams({
      model,
      language,
      smart_format: String(smartFormat),
      punctuate: String(punctuate),
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
    });

    const apiKey = process.env.DEEPGRAM_API_KEY || "";
    const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    const ws = new WebSocket(wsUrl, ["token", apiKey]);
    active.ws = ws as any;

    ws.addEventListener("open", () => {
      logger.info(`Deepgram WebSocket connected for "${active.doc.name}"`);
    });

    const messageHandler = (str: string) => {
      try {
        const data = JSON.parse(str);
        if (data.type === "Results" && data.is_final) {
          const transcript = data.channel?.alternatives?.[0]?.transcript;
          if (transcript && transcript.trim().length > 0) {
            active.transcriptBuffer += `${transcript} `;
          }
        }
      } catch (err) {
        logger.debug(`Deepgram message parse error for "${active.doc.name}": ${err}`);
      }
    };

    ws.addEventListener("message", (event) => {
      messageHandler(typeof event.data === "string" ? event.data : String(event.data));
    });

    ws.addEventListener("close", (event) => {
      if (active.stopping) return;
      logger.warn(
        `Deepgram WebSocket closed for "${active.doc.name}" (code=${event.code}, reason=${event.reason})`
      );
      active.ws = null;
      void this.scheduleReconnect(active, "deepgram");
    });

    ws.addEventListener("error", () => {
      logger.error(`Deepgram WebSocket error for "${active.doc.name}"`);
    });
  }

  private async scheduleReconnect(
    active: ActiveStream,
    component: "ffmpeg" | "deepgram"
  ): Promise<void> {
    if (active.stopping) {
      return;
    }

    // Re-read from DB to check if still active
    const doc = await RadioStream.findById(active.streamId);
    if (!doc || doc.status !== "active") {
      logger.info(`Stream "${active.doc.name}" no longer active, not reconnecting`);
      this.activeStreams.delete(active.streamId);
      return;
    }

    const appConfig = await loadAppConfig();
    const maxReconnects = appConfig.radioTranscriber.maxReconnectAttempts;
    if (doc.reconnectCount >= maxReconnects) {
      logger.error(
        `Stream "${active.doc.name}" exceeded max reconnects (${maxReconnects}), marking as error`
      );
      await RadioStream.findByIdAndUpdate(doc._id, {
        $set: {
          status: RADIO_STREAM_STATUS.error,
          errorMessage: `Exceeded max reconnect attempts (${maxReconnects})`,
        },
      });
      this.activeStreams.delete(active.streamId);
      return;
    }

    await RadioStream.findByIdAndUpdate(doc._id, {$inc: {reconnectCount: 1}});

    const delay = appConfig.radioTranscriber.reconnectDelayMs;
    logger.info(
      `Reconnecting ${component} for "${active.doc.name}" in ${delay}ms (attempt ${doc.reconnectCount + 1}/${maxReconnects})`
    );

    setTimeout(() => {
      if (active.stopping || !this.activeStreams.has(active.streamId)) {
        return;
      }

      if (component === "ffmpeg") {
        this.launchFfmpeg(active);
      } else {
        this.launchDeepgram(active);
      }
    }, delay);
  }

  private async identifySong(active: ActiveStream): Promise<void> {
    if (active.songId.isIdentifying || active.stopping) {
      return;
    }
    active.songId.isIdentifying = true;

    try {
      await this.doIdentifySong(active);
    } finally {
      active.songId.isIdentifying = false;
    }
  }

  private async doIdentifySong(active: ActiveStream): Promise<void> {
    // Honor runtime toggle so flipping the flag in AppConfig takes effect
    // without restarting the stream.
    const appConfig = await loadAppConfig();
    if (appConfig.radioTranscriber.songIdentification === false) {
      return;
    }

    const accessKey = process.env.ACRCLOUD_ACCESS_KEY!;
    const secretKey = process.env.ACRCLOUD_SECRET_KEY!;

    if (active.audioBufferBytes < BYTES_PER_SECOND * 5) {
      return; // not enough audio yet
    }

    const pcmData = Buffer.concat(active.audioBuffer);
    const audioData = wrapPcmAsWav(pcmData, 16000, 1, 16);

    const result = await queryAcrCloud({audioBuffer: audioData, accessKey, secretKey});

    if (!result) {
      // No song match — it's speech. Allow transcripts to post.
      if (active.songId.musicPlaying) {
        logger.info(`Music ended on "${active.doc.name}", resuming transcription`);
        await this.emitMusicSentinel(active, MUSIC_END_SENTINEL);
      }
      active.songId.musicPlaying = false;
      active.songId.lastIdentifiedSong = null;
      return;
    }

    // Song matched — suppress transcripts (they're lyrics)
    const wasPlaying = active.songId.musicPlaying;
    active.songId.musicPlaying = true;
    if (!wasPlaying) {
      // Transition into music. Insert a sentinel Transcript so downstream
      // consumers (e.g. TriviaMonitor) can finalize any pending questions —
      // the DJ stopped talking.
      await this.emitMusicSentinel(active, MUSIC_START_SENTINEL);
    }

    const songKey = `${result.artist} - ${result.title}`;

    // Only post if it's a different song
    if (songKey === active.songId.lastIdentifiedSong) {
      return;
    }

    active.songId.lastIdentifiedSong = songKey;

    const timestamp = this.formatTimestamp(new Date());
    const message = `[${timestamp}] :musical_note: *Now Playing:* ${result.artist} — ${result.title}${result.album ? ` (${result.album})` : ""}`;

    logger.info(`Song identified on "${active.doc.name}": ${songKey}`);

    // "Now Playing" posts are gated separately so music-gating can run without
    // spamming Slack.
    const postSongIdToSlack = appConfig.radioTranscriber.postSongIdToSlack !== false;

    try {
      if (postSongIdToSlack && active.doc.slackWebhookUrl) {
        await sendToSlackWebhook({webhookUrl: active.doc.slackWebhookUrl, text: message});
      }
      if (postSongIdToSlack && active.doc.targetGroupId) {
        await this.channelManager.sendMessageToGroup(active.doc.targetGroupId.toString(), message);
      }
    } catch (err) {
      logger.error(`Failed to post song ID for "${active.doc.name}": ${err}`);
    }
  }

  /**
   * Write a sentinel Transcript signaling a music-state transition. Used by
   * TriviaMonitor to decide when to finalize pending questions.
   */
  private async emitMusicSentinel(active: ActiveStream, sentinel: string): Promise<void> {
    try {
      await Transcript.create({
        radioStreamId: active.doc._id,
        targetGroupId: active.doc.targetGroupId,
        content: sentinel,
      });
    } catch (err) {
      logger.warn(`Failed to emit music sentinel for "${active.doc.name}": ${err}`);
    }
  }

  private formatTimestamp(date: Date): string {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: "America/Chicago",
    });
  }

  /**
   * Strip a trailing parenthesized song title that Deepgram sometimes appends
   * when transcribing music, e.g. "some lyrics here (Song Title)".
   */
  private stripTrailingSongTitle(text: string): string {
    return text.replace(/\s*\([^)]+\)\s*$/, "").trim();
  }

  private async flushTranscript(active: ActiveStream): Promise<void> {
    const text = this.stripTrailingSongTitle(active.transcriptBuffer.trim());
    if (text.length === 0) {
      active.flushAudioChunks = [];
      return;
    }

    const batchStart = active.batchStartedAt;
    const audioChunks = active.flushAudioChunks;
    active.transcriptBuffer = "";
    active.batchStartedAt = new Date();
    active.flushAudioChunks = [];

    // Note: we always post transcripts even during music — better to have lyrics than miss speech

    const timestamp = this.formatTimestamp(batchStart);
    const messageText = `[${timestamp}] ${text}`;

    // Convert audio to MP3 and upload with message
    let mp3Buffer: Buffer | null = null;
    let recordingUrl: string | undefined;
    logger.debug(`Audio chunks for flush: ${audioChunks.length} chunks`);
    if (audioChunks.length > 0) {
      try {
        const pcm = Buffer.concat(audioChunks);
        mp3Buffer = await pcmToMp3(pcm, this.ffmpegPath);
      } catch (err) {
        logger.debug(`Failed to convert audio to MP3 for "${active.doc.name}": ${err}`);
      }
    }

    // Save MP3 to disk
    if (mp3Buffer) {
      try {
        const mp3Dir = path.join(paths.data, "recordings", active.streamId);
        await fs.mkdir(mp3Dir, {recursive: true});
        const mp3Filename = `${batchStart.toISOString().replace(/[:.]/g, "-")}.mp3`;
        await fs.writeFile(path.join(mp3Dir, mp3Filename), mp3Buffer);
        recordingUrl = `${getRecordingPublicBaseUrl()}/static/recordings/${active.streamId}/${mp3Filename}`;
      } catch (err) {
        logger.debug(`Failed to save MP3 for "${active.doc.name}": ${err}`);
      }
    }

    // Always save to DB
    try {
      await Transcript.create({
        radioStreamId: active.doc._id,
        targetGroupId: active.doc.targetGroupId,
        content: text,
        recordingUrl,
      });
    } catch (err) {
      logger.error(`Failed to save transcript for "${active.doc.name}": ${err}`);
    }

    try {
      // AppConfig.radioTranscriber.postTranscriptsToSlack gates the raw per-flush
      // Slack post. When disabled, transcripts are still written to the DB so
      // downstream consumers like TriviaMonitor (Haiku question extractor +
      // web-search research) keep running.
      const appConfig = await loadAppConfig();
      const postToSlack = appConfig.radioTranscriber.postTranscriptsToSlack !== false;

      if (postToSlack && active.doc.slackBotToken && active.doc.slackChannelId) {
        await postMessageToSlack({
          botToken: active.doc.slackBotToken,
          channelId: active.doc.slackChannelId,
          text: messageText,
          recordingUrl,
        });
      } else if (postToSlack && active.doc.slackWebhookUrl) {
        await sendToSlackWebhook({
          webhookUrl: active.doc.slackWebhookUrl,
          text: messageText,
          recordingUrl,
        });
      }

      if (active.doc.targetGroupId) {
        await this.channelManager.sendMessageToGroup(
          active.doc.targetGroupId.toString(),
          messageText
        );
      }

      await RadioStream.findByIdAndUpdate(active.doc._id, {
        $set: {lastTranscriptAt: new Date()},
      });
      logger.debug(
        `Flushed transcript for "${active.doc.name}" (${text.length} chars, mp3: ${mp3Buffer ? mp3Buffer.length : 0} bytes)`
      );
    } catch (err) {
      logger.error(`Failed to send transcript for "${active.doc.name}": ${err}`);
      active.transcriptBuffer = `${text} ${active.transcriptBuffer}`;
    }
  }
}
