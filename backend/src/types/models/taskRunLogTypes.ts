import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface TaskRunLogFields {
  taskId?: mongoose.Types.ObjectId;
  groupId: mongoose.Types.ObjectId;
  trigger: "scheduled" | "message" | "webhook" | "websocket" | "manual" | "delegated";
  classification: "public" | "internal" | "sensitive" | "critical";
  modelBackend: "claude" | "ollama" | "codex" | "gemini";
  modelName?: string;
  status: "running" | "completed" | "failed" | "timeout";
  prompt?: string;
  result?: string;
  error?: string;
  durationMs?: number;
  startedAt: Date;
  completedAt?: Date;
  /** Whether this run produced a structured RichResponse via respond_with_card. */
  richPayloadEmitted?: boolean;
  /** Number of cards in the emitted RichResponse (0 when none). */
  cardCount?: number;
  /** Whether truncation kicked in (cards > MAX_CARDS). */
  truncated?: boolean;
}

export type TaskRunLogDocument = DefaultDoc & TaskRunLogFields;
export type TaskRunLogStatics = DefaultStatics<TaskRunLogDocument>;
export type TaskRunLogModel = DefaultModel<TaskRunLogDocument> & TaskRunLogStatics;
export type TaskRunLogSchema = mongoose.Schema<TaskRunLogDocument, TaskRunLogModel>;
