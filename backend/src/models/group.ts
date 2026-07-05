import mongoose from "mongoose";
import type {GroupDocument, GroupModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const groupSchema = new mongoose.Schema<GroupDocument, GroupModel>(
  {
    name: {type: String, required: true, trim: true},
    folder: {type: String, required: true, unique: true},
    channelId: {type: mongoose.Schema.Types.ObjectId, ref: "Channel", required: true},
    externalId: {type: String, required: true},
    trigger: {type: String, default: "@Shade"},
    requiresTrigger: {type: Boolean, default: true},
    isMain: {type: Boolean, default: false},
    modelConfig: {
      defaultBackend: {
        type: String,
        // "mock" is the AI-testability harness backend (IP-012): the group's
        // runs execute through MockAgentRunner instead of a real model.
        enum: ["claude", "ollama", "codex", "gemini", "mock"],
        default: "claude",
      },
      defaultModel: {type: String},
      endpoint: {type: String},
      fallbackBackend: {type: String, enum: ["claude", "ollama", "codex", "gemini", "mock"]},
    },
    executionConfig: {
      mode: {type: String, enum: ["direct", "container"], default: "direct"},
      timeout: {type: Number, default: 300000},
      idleTimeout: {type: Number, default: 60000},
      maxConcurrent: {type: Number, default: 1},
    },
    // Lifecycle for feature channels. Undefined for non-feature groups.
    // `planning` → OpenAI planner (AppConfig `models.planner`, default gpt-5.4)
    // `implementing` / `complete` → Claude Agent SDK runner
    featurePhase: {
      type: String,
      enum: ["planning", "implementing", "complete"],
      required: false,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

addDefaultPlugins(groupSchema);

export const Group = mongoose.model<GroupDocument, GroupModel>("Group", groupSchema);
