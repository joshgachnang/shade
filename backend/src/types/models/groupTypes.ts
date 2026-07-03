import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export type ModelBackend = "claude" | "ollama" | "codex" | "gemini" | "mock";

export interface GroupModelConfig {
  defaultBackend?: ModelBackend;
  defaultModel?: string;
  endpoint?: string;
  fallbackBackend?: ModelBackend;
}

export interface GroupExecutionConfig {
  mode?: "direct" | "container";
  timeout?: number;
  idleTimeout?: number;
  maxConcurrent?: number;
}

/**
 * Lifecycle state for feature channels (created via `create_feature`).
 *  - `planning`: messages are routed to the OpenAI planner (GPT-5.4) which
 *    drives the `/ip` workflow.
 *  - `implementing`: messages are routed to the Claude Agent SDK runner,
 *    which executes the approved plan via `/implement`.
 *  - `complete`: the feature has shipped; further messages still go to the
 *    Claude runner, but the channel is expected to be archived.
 *
 * Regular (non-feature) groups leave this unset and always use the Claude
 * runner.
 */
export type FeaturePhase = "planning" | "implementing" | "complete";

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
  featurePhase?: FeaturePhase;
}

export type GroupDocument = DefaultDoc & GroupFields;
export type GroupStatics = DefaultStatics<GroupDocument>;
export type GroupModel = DefaultModel<GroupDocument> & GroupStatics;
export type GroupSchema = mongoose.Schema<GroupDocument, GroupModel>;
