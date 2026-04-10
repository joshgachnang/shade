import {logger} from "@terreno/api";
import mongoose from "mongoose";
import type {AppConfigDocument, AppConfigModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const appConfigSchema = new mongoose.Schema<AppConfigDocument, AppConfigModel>(
  {
    assistantName: {type: String, default: "Shade", trim: true},
    triggerPattern: {type: String, default: "@Shade"},

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
