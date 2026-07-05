import {randomBytes} from "node:crypto";
import {logger} from "@terreno/api";
import mongoose from "mongoose";
import type {AppConfigDocument, AppConfigModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

/**
 * Generates a 256-bit hex-encoded random secret, used as a sensible default
 * for JWT and MCP auth tokens on first boot. Callers can still override via
 * env vars (which take precedence after `hydrateEnvFromConfig`).
 */
const generateSecret = (): string => randomBytes(32).toString("hex");

const appConfigSchema = new mongoose.Schema<AppConfigDocument, AppConfigModel>(
  {
    assistantName: {type: String, default: "Shade", trim: true},
    triggerPattern: {type: String, default: "@Shade"},

    // Filesystem path for writable data (movies, recordings, etc.). Defaults
    // to "" which means "use SHADE_DATA_DIR env var or ./data".
    dataDir: {type: String, default: ""},

    // Public-facing base URL the backend advertises to integrations (Slack
    // buttons, webhook callbacks). Empty string falls back to SHADE_PUBLIC_URL
    // or the production default.
    publicUrl: {type: String, default: ""},

    // System prompt used when researching trivia questions with Claude. Top-
    // level and stored as a plain string so it's easy to edit at runtime.
    // Empty string falls back to the TRIVIA_ANSWERER_PROMPT constant in
    // orchestrator/services/trivia/prompts.ts.
    triviaResearchSystemPrompt: {type: String, default: ""},

    logging: {
      // pino log level override: trace | debug | info | warn | error | fatal
      level: {type: String, default: ""},
    },

    auth: {
      // JWT secrets. Empty string falls back to TOKEN_SECRET /
      // REFRESH_TOKEN_SECRET env vars.
      tokenSecret: {type: String, default: ""},
      refreshTokenSecret: {type: String, default: ""},
    },

    pollIntervals: {
      message: {type: Number, default: 2000},
      task: {type: Number, default: 60000},
      scheduler: {type: Number, default: 5 * 60 * 1000},
      ipc: {type: Number, default: 1000},
      imessage: {type: Number, default: 5000},
    },

    concurrency: {
      maxGlobal: {type: Number, default: 5},
    },

    radioTranscriber: {
      enabled: {type: Boolean, default: false},
      defaultBatchIntervalMs: {type: Number, default: 15000},
      maxReconnectAttempts: {type: Number, default: 50},
      reconnectDelayMs: {type: Number, default: 5000},
      // Controls whether per-flush transcript batches are echoed directly to
      // Slack (webhook / bot token). Transcripts are always saved to the DB so
      // downstream consumers (e.g. TriviaMonitor) keep working when disabled.
      postTranscriptsToSlack: {type: Boolean, default: true},
      // Controls ACRCloud polling. Required for TriviaMonitor's music-gated
      // question finalization (a [MUSIC_START] sentinel is emitted on transition).
      songIdentification: {type: Boolean, default: true},
      // Controls the "Now Playing: Artist — Title" Slack post. When false,
      // ACRCloud still polls for music-gating but no Slack post fires.
      postSongIdToSlack: {type: Boolean, default: true},
    },

    orchestrator: {
      baseRetryDelayMs: {type: Number, default: 5000},
      maxRetries: {type: Number, default: 5},
      maxResumes: {type: Number, default: 3},
      progressMessageIntervalMs: {type: Number, default: 60000},
      conversationWindowMs: {type: Number, default: 4 * 60 * 60 * 1000},
    },

    agent: {
      // Global default Anthropic model for agent runs. Per-group overrides
      // (Group.modelConfig.defaultModel) take precedence. Empty string falls
      // back to the Agent SDK's built-in default model.
      model: {type: String, default: ""},
      // Cheap/fast model tier for auxiliary work (detection, classification,
      // summarization). Consumed by the trivia detector; other lightweight
      // consumers should adopt it instead of hardcoding a model name.
      auxiliaryModel: {type: String, default: "claude-haiku-4-5-20251001"},
      maxTurns: {type: Number, default: 50},
      progressIntervalMs: {type: Number, default: 30000},
      allowedTools: {type: [String], default: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]},
      // Enables the Claude Agent SDK's native subagents (the Task tool) so a
      // single turn can fan out short-lived parallel subagents.
      enableSubagents: {type: Boolean, default: true},
    },

    memory: {
      // Master switch for the agent memory tools and prompt block.
      enabled: {type: Boolean, default: true},
      // Character cap per memory file (global/group/user).
      maxFileChars: {type: Number, default: 6000},
      // Character cap per skill file.
      maxSkillChars: {type: Number, default: 8000},
      // Maximum results returned by the search_history tool.
      historySearchLimit: {type: Number, default: 8},
    },

    taskWorker: {
      // Master switch for the agent task board worker loop.
      enabled: {type: Boolean, default: true},
      // Maximum number of board tasks run concurrently by this process.
      concurrency: {type: Number, default: 2},
      // How often the worker polls for claimable tasks.
      pollMs: {type: Number, default: 5000},
      // Interval between heartbeat updates while a task is running.
      heartbeatMs: {type: Number, default: 15000},
      // Heartbeat older than this is considered stale and the task is reclaimed.
      staleMs: {type: Number, default: 60000},
      // Per-attempt execution timeout (15 min). Also bounds the worker
      // process's graceful-shutdown drain (workerMain.ts).
      taskTimeoutMs: {type: Number, default: 900000},
      // Whether the gateway process runs the worker loop in-process. Set to
      // false once dedicated worker processes (`bun run worker`) are deployed
      // so board work becomes worker-only (IP-010 rollout step 3).
      runInGateway: {type: Boolean, default: true},
    },

    scheduler: {
      // When true, due ScheduledTasks are dispatched as AgentTask board work
      // (run by workers, results delivered via deliverResult) instead of a
      // synthetic message through the gateway's GroupQueue (IP-010 rollout
      // step 4).
      useTaskBoard: {type: Boolean, default: false},
    },

    apiKeys: {
      braveSearch: {type: String, default: ""},
      exa: {type: String, default: ""},
      tavily: {type: String, default: ""},
      anthropic: {type: String, default: ""},
      openRouter: {type: String, default: ""},
      // OpenAI API key used for feature-channel implementation planning
      // (the /ip workflow runs against `models.planner`). Stored here per the
      // "all service credentials belong in AppConfig" rule.
      openai: {type: String, default: ""},
      deepgram: {type: String, default: ""},
      acrCloudAccessKey: {type: String, default: ""},
      acrCloudSecretKey: {type: String, default: ""},
      github: {type: String, default: ""},
    },

    models: {
      answerer: {type: String, default: "claude-sonnet-4-6"},
      // Trivia detector model override. Empty string falls back to
      // agent.auxiliaryModel (the shared cheap-model tier).
      detector: {type: String, default: ""},
      // OpenAI model used to drive the /ip planning conversation inside
      // feature Slack channels. Implementation is still handed off to the
      // Claude Agent SDK once the plan is approved.
      planner: {type: String, default: "gpt-5.4"},
    },

    mcpMedia: {
      authToken: {type: String, default: ""},
      port: {type: Number, default: 8081},
      sonarr: {
        baseUrl: {type: String, default: ""},
        apiKey: {type: String, default: ""},
      },
      radarr: {
        baseUrl: {type: String, default: ""},
        apiKey: {type: String, default: ""},
      },
      nzbget: {
        baseUrl: {type: String, default: ""},
        username: {type: String, default: "nzbget"},
        password: {type: String, default: ""},
      },
      plex: {
        baseUrl: {type: String, default: ""},
        token: {type: String, default: ""},
      },
    },

    prWatch: {
      enabled: {type: Boolean, default: false},
      groupId: {type: String, default: ""},
      pollIntervalMs: {type: Number, default: 120000},
      githubUsername: {type: String, default: ""},
      autoRespondToBots: {type: Boolean, default: true},
      autoFixConflicts: {type: Boolean, default: true},
      reposBaseDir: {type: String, default: "data/repos"},
      // Anthropic model used to draft auto-responses to bot reviews
      // (e.g. dependabot, lint bots). Kept separate from `models.*` so
      // operators can tune PR-watcher behavior without touching the
      // trivia/answerer models.
      botResponseModel: {type: String, default: "claude-haiku-4-5-20251001"},
      // Prompts used by the PR watcher. Empty strings fall back to the
      // module-level defaults in orchestrator/services/prWatcher.ts so a
      // fresh AppConfig still produces working behavior. Operators can
      // edit these via the admin UI to tune PR-watcher behavior without
      // redeploying.
      prompts: {
        // Agent prompt for resolving merge conflicts on a PR branch.
        fixConflicts: {type: String, default: ""},
        // Agent prompt for watching CI and auto-fixing failures.
        checkWatcher: {type: String, default: ""},
        // System prompt for generating replies to bot review comments.
        botReviewSystem: {type: String, default: ""},
      },
    },

    triviaMonitor: {
      enabled: {type: Boolean, default: false},
      groupId: {type: String, default: ""},
      // Slack users allowed to issue !trivia commands (chat ID / external ID).
      allowedUserIds: {type: [String], default: []},
      questionsWebhook: {type: String, default: ""},
      answersWebhook: {type: String, default: ""},
    },

    triviaStats: {
      slackWebhook: {type: String, default: ""},
      blueskyIdentifier: {type: String, default: ""},
      blueskyPassword: {type: String, default: ""},
    },

    notifications: {
      enabled: {type: Boolean, default: true},
      slackChannel: {type: String, default: "general"},
    },

    richResponses: {
      enabled: {type: Boolean, default: true},
      autoTruncate: {type: Boolean, default: true},
    },

    maps: {
      mapboxAccessToken: {type: String, default: ""},
    },

    // AI testability harness (IP-012). Only read when SHADE_TEST_MODE=1.
    testMode: {
      // When no LlmFixture matches a prompt, echo it back instead of failing.
      echoFallback: {type: Boolean, default: true},
      // Base latency added to every mock agent run (fixture delayMs stacks on top).
      simulateLatencyMs: {type: Number, default: 0},
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

addDefaultPlugins(appConfigSchema);

// Invalidate cache on save so the next loadAppConfig() fetches fresh data, and
// warn the admin if any restart-required field changed. We import lazily to
// avoid a circular dependency between `models/appConfig.ts` and
// `utils/configEnv.ts`.
appConfigSchema.post("save", async (doc) => {
  cachedConfig = null;
  try {
    const {warnOnRestartRequiredChanges} = await import("../utils/configEnv");
    warnOnRestartRequiredChanges(doc as AppConfigDocument);
  } catch {
    // Non-fatal — the hook is best-effort operator feedback.
  }
});

appConfigSchema.post("findOneAndUpdate", async (doc) => {
  cachedConfig = null;
  if (!doc) {
    return;
  }
  try {
    const {warnOnRestartRequiredChanges} = await import("../utils/configEnv");
    warnOnRestartRequiredChanges(doc as unknown as AppConfigDocument);
  } catch {
    // Non-fatal.
  }
});

// Deletes must also invalidate the cache — otherwise loadAppConfig() keeps
// returning a document that no longer exists and any save() on it fails with
// DocumentNotFoundError.
appConfigSchema.post(["deleteOne", "deleteMany", "findOneAndDelete"], () => {
  cachedConfig = null;
});

export const AppConfig = mongoose.model<AppConfigDocument, AppConfigModel>(
  "AppConfig",
  appConfigSchema
);

let cachedConfig: AppConfigDocument | null = null;

/**
 * Load the singleton AppConfig from the database.
 * Creates one with defaults if none exists. Caches the result in memory.
 *
 * On first-boot creation we seed randomly-generated values for secrets that
 * have no sensible static default (JWT + MCP auth tokens). Operators can
 * rotate them later via the admin UI; the app must be restarted for the new
 * values to take effect.
 */
export const loadAppConfig = async (): Promise<AppConfigDocument> => {
  if (cachedConfig) {
    return cachedConfig;
  }

  let doc = await AppConfig.findOneOrNone({});
  if (!doc) {
    logger.info("No AppConfig found, creating default configuration");
    doc = await AppConfig.create({
      auth: {
        tokenSecret: generateSecret(),
        refreshTokenSecret: generateSecret(),
      },
      mcpMedia: {
        authToken: generateSecret(),
      },
    });
  }

  cachedConfig = doc;
  return doc;
};

/**
 * Force-reload the config from the database (e.g. after an update via the API).
 */
export const reloadAppConfig = async (): Promise<AppConfigDocument> => {
  cachedConfig = null;
  return loadAppConfig();
};
