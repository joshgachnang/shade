import type mongoose from "mongoose";
import type { DefaultDoc, DefaultModel, DefaultStatics } from "./userTypes";

export interface TaskRunLogFields {
  taskId?: mongoose.Types.ObjectId;
  groupId: mongoose.Types.ObjectId;
  trigger: "scheduled" | "message" | "webhook" | "websocket" | "manual";
  classification: "public" | "internal" | "sensitive" | "critical";
  modelBackend: "claude" | "ollama" | "codex";
  modelName?: string;
  status: "running" | "completed" | "failed" | "timeout";
  prompt?: string;
  result?: string;
  error?: string;
  durationMs?: number;
  startedAt: Date;
  completedAt?: Date;
}

export type TaskRunLogDocument = DefaultDoc & TaskRunLogFields;
export type TaskRunLogStatics = DefaultStatics<TaskRunLogDocument>;
export type TaskRunLogModel = DefaultModel<TaskRunLogDocument> & TaskRunLogStatics;
export type TaskRunLogSchema = mongoose.Schema<TaskRunLogDocument, TaskRunLogModel>;
