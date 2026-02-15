import type mongoose from "mongoose";
import type { DefaultDoc, DefaultModel, DefaultStatics } from "./userTypes";

export interface GroupModelConfig {
  defaultBackend?: "claude" | "ollama" | "codex";
  defaultModel?: string;
  endpoint?: string;
  fallbackBackend?: "claude" | "ollama" | "codex";
}

export interface GroupExecutionConfig {
  mode?: "direct" | "container";
  timeout?: number;
  idleTimeout?: number;
  maxConcurrent?: number;
}

export interface GroupFields {
  name: string;
  folder: string;
  channelId: mongoose.Types.ObjectId;
  externalId: string;
  trigger: string;
  requiresTrigger: boolean;
  isMain: boolean;
  modelConfig: GroupModelConfig;
  executionConfig: GroupExecutionConfig;
}

export type GroupDocument = DefaultDoc & GroupFields;
export type GroupStatics = DefaultStatics<GroupDocument>;
export type GroupModel = DefaultModel<GroupDocument> & GroupStatics;
export type GroupSchema = mongoose.Schema<GroupDocument, GroupModel>;
