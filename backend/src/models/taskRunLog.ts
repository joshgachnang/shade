import mongoose from "mongoose";
import type {TaskRunLogDocument, TaskRunLogModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const taskRunLogSchema = new mongoose.Schema<TaskRunLogDocument, TaskRunLogModel>(
  {
    taskId: {type: mongoose.Schema.Types.ObjectId, ref: "ScheduledTask"},
    groupId: {type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true},
    trigger: {
      type: String,
      required: true,
      enum: ["scheduled", "message", "webhook", "websocket", "manual"],
    },
    classification: {
      type: String,
      required: true,
      enum: ["public", "internal", "sensitive", "critical"],
    },
    modelBackend: {type: String, required: true, enum: ["claude", "ollama", "codex"]},
    modelName: {type: String},
    status: {type: String, required: true, enum: ["running", "completed", "failed", "timeout"]},
    prompt: {type: String},
    result: {type: String},
    error: {type: String},
    durationMs: {type: Number},
    startedAt: {type: Date, required: true},
    completedAt: {type: Date},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

taskRunLogSchema.index({groupId: 1, startedAt: -1});

addDefaultPlugins(taskRunLogSchema);

export const TaskRunLog = mongoose.model<TaskRunLogDocument, TaskRunLogModel>(
  "TaskRunLog",
  taskRunLogSchema
);
