import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export type AgentTaskStatus =
  | "pending"
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentTaskFields {
  groupId: mongoose.Types.ObjectId;
  /** Set when delegated by another board task (blocked in v1) — kept for lineage. */
  parentTaskId?: mongoose.Types.ObjectId;
  /** The conversation turn that delegated this task. */
  sourceMessageId?: mongoose.Types.ObjectId;
  /** The ScheduledTask that spawned this run (board-dispatched scheduled runs). */
  scheduledTaskId?: mongoose.Types.ObjectId;
  title: string;
  prompt: string;
  status: AgentTaskStatus;
  /** Higher runs first. */
  priority: number;
  workerId?: string;
  claimedAt?: Date;
  heartbeatAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  attempts: number;
  maxAttempts: number;
  /** Post the result to the group's channel on completion. */
  deliverResult: boolean;
  /** Set by cancel_agent_task; the worker checks it between heartbeats. */
  cancelRequested: boolean;
  result?: string;
  error?: string;
}

export type AgentTaskDocument = DefaultDoc & AgentTaskFields;
export type AgentTaskStatics = DefaultStatics<AgentTaskDocument>;
export type AgentTaskModel = DefaultModel<AgentTaskDocument> & AgentTaskStatics;
export type AgentTaskSchema = mongoose.Schema<AgentTaskDocument, AgentTaskModel>;
