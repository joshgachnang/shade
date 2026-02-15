import type mongoose from "mongoose";
import type { DefaultDoc, DefaultModel, DefaultStatics } from "./userTypes";

export interface ScheduledTaskFields {
  groupId: mongoose.Types.ObjectId;
  name: string;
  prompt: string;
  scheduleType: "cron" | "interval" | "once";
  schedule: string;
  status: "active" | "paused" | "completed" | "cancelled";
  classification: "public" | "internal" | "sensitive" | "critical";
  contextMode: "group" | "isolated";
  nextRunAt?: Date;
  lastRunAt?: Date;
  runCount: number;
  maxRuns?: number;
}

export type ScheduledTaskDocument = DefaultDoc & ScheduledTaskFields;
export type ScheduledTaskStatics = DefaultStatics<ScheduledTaskDocument>;
export type ScheduledTaskModel = DefaultModel<ScheduledTaskDocument> & ScheduledTaskStatics;
export type ScheduledTaskSchema = mongoose.Schema<ScheduledTaskDocument, ScheduledTaskModel>;
