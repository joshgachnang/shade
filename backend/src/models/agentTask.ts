import mongoose from "mongoose";
import type {AgentTaskDocument, AgentTaskModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const agentTaskSchema = new mongoose.Schema<AgentTaskDocument, AgentTaskModel>(
  {
    groupId: {type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true},
    // Set when delegated by another board task (blocked in v1) — kept for lineage.
    parentTaskId: {type: mongoose.Schema.Types.ObjectId, ref: "AgentTask"},
    // The conversation turn that delegated this task.
    sourceMessageId: {type: mongoose.Schema.Types.ObjectId, ref: "Message"},
    title: {type: String, required: true},
    prompt: {type: String, required: true},
    status: {
      type: String,
      default: "pending",
      enum: ["pending", "claimed", "running", "completed", "failed", "cancelled"],
    },
    // Higher runs first.
    priority: {type: Number, default: 0},
    workerId: {type: String},
    claimedAt: {type: Date},
    heartbeatAt: {type: Date},
    startedAt: {type: Date},
    completedAt: {type: Date},
    attempts: {type: Number, default: 0},
    maxAttempts: {type: Number, default: 2},
    // Post the result to the group's channel on completion.
    deliverResult: {type: Boolean, default: false},
    // Set by cancel_agent_task; the worker checks it between heartbeats.
    cancelRequested: {type: Boolean, default: false},
    result: {type: String},
    error: {type: String},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

// Claim query: oldest pending task with the highest priority.
agentTaskSchema.index({status: 1, priority: -1, created: 1});
agentTaskSchema.index({groupId: 1, created: -1});
// Reclaim sweep: claimed/running tasks with stale heartbeats.
agentTaskSchema.index({status: 1, heartbeatAt: 1});

addDefaultPlugins(agentTaskSchema);

export const AgentTask = mongoose.model<AgentTaskDocument, AgentTaskModel>(
  "AgentTask",
  agentTaskSchema
);
