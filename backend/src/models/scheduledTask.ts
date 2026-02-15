import mongoose from "mongoose";
import type {ScheduledTaskDocument, ScheduledTaskModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const scheduledTaskSchema = new mongoose.Schema<ScheduledTaskDocument, ScheduledTaskModel>(
  {
    groupId: {type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true},
    name: {type: String, required: true, trim: true},
    prompt: {type: String, required: true},
    scheduleType: {type: String, required: true, enum: ["cron", "interval", "once"]},
    schedule: {type: String, required: true},
    status: {
      type: String,
      default: "active",
      enum: ["active", "paused", "completed", "cancelled"],
    },
    classification: {
      type: String,
      default: "internal",
      enum: ["public", "internal", "sensitive", "critical"],
    },
    contextMode: {type: String, default: "isolated", enum: ["group", "isolated"]},
    nextRunAt: {type: Date},
    lastRunAt: {type: Date},
    runCount: {type: Number, default: 0},
    maxRuns: {type: Number},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

scheduledTaskSchema.index({status: 1, nextRunAt: 1});

addDefaultPlugins(scheduledTaskSchema);

export const ScheduledTask = mongoose.model<ScheduledTaskDocument, ScheduledTaskModel>(
  "ScheduledTask",
  scheduledTaskSchema
);
