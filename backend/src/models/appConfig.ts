import {logger} from "@terreno/api";
import mongoose from "mongoose";
import type {AppConfigDocument, AppConfigModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

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
      ipc: {type: Number, default: 1000},
      imessage: {type: Number, default: 5000},
    },

    concurrency: {
      maxGlobal: {type: Number, default: 5},
    },

    radioTranscriber: {
      defaultBatchIntervalMs: {type: Number, default: 15000},
      maxReconnectAttempts: {type: Number, default: 50},
      reconnectDelayMs: {type: Number, default: 5000},
    },

    orchestrator: {
      baseRetryDelayMs: {type: Number, default: 5000},
      maxRetries: {type: Number, default: 5},
      maxResumes: {type: Number, default: 3},
      progressMessageIntervalMs: {type: Number, default: 60000},
      conversationWindowMs: {type: Number, default: 4 * 60 * 60 * 1000},
    },

    agent: {
      maxTurns: {type: Number, default: 50},
      progressIntervalMs: {type: Number, default: 30000},
      allowedTools: {type: [String], default: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]},
    },

    apiKeys: {
      braveSearch: {type: String, default: ""},
      exa: {type: String, default: ""},
      tavily: {type: String, default: ""},
      anthropic: {type: String, default: ""},
      openRouter: {type: String, default: ""},
      deepgram: {type: String, default: ""},
      acrCloudAccessKey: {type: String, default: ""},
      acrCloudSecretKey: {type: String, default: ""},
      github: {type: String, default: ""},
    },

    models: {
      answerer: {type: String, default: "claude-sonnet-4-20250514"},
      detector: {type: String, default: "claude-haiku-4-5-20251001"},
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

    triviaAutoSearch: {
      enabled: {type: Boolean, default: false},
      groupId: {type: String, default: ""},
      allowedUserIds: {type: [String], default: []},
    },

    prWatch: {
      enabled: {type: Boolean, default: false},
      groupId: {type: String, default: ""},
      pollIntervalMs: {type: Number, default: 120000},
      githubUsername: {type: String, default: ""},
      autoRespondToBots: {type: Boolean, default: true},
      autoFixConflicts: {type: Boolean, default: true},
      reposBaseDir: {type: String, default: "data/repos"},
    },

    triviaMonitor: {
      enabled: {type: Boolean, default: false},
      groupId: {type: String, default: ""},
      questionsWebhook: {type: String, default: ""},
      answersWebhook: {type: String, default: ""},
    },

    triviaStats: {
      slackWebhook: {type: String, default: ""},
      blueskyIdentifier: {type: String, default: ""},
      blueskyPassword: {type: String, default: ""},
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

addDefaultPlugins(appConfigSchema);

// Invalidate cache on save so the next loadAppConfig() fetches fresh data
appConfigSchema.post("save", () => {
  cachedConfig = null;
});

appConfigSchema.post("findOneAndUpdate", () => {
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
 */
export const loadAppConfig = async (): Promise<AppConfigDocument> => {
  if (cachedConfig) {
    return cachedConfig;
  }

  let doc = await AppConfig.findOneOrNone({});
  if (!doc) {
    logger.info("No AppConfig found, creating default configuration");
    doc = await AppConfig.create({});
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
