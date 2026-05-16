import mongoose from "mongoose";
import type {EdgeAgentDocument, EdgeAgentModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const edgeAgentSchema = new mongoose.Schema<EdgeAgentDocument, EdgeAgentModel>(
  {
    name: {type: String, required: true, trim: true, unique: true},
    agentType: {type: String, required: true},
    status: {
      type: String,
      default: "pending",
      enum: ["pending", "approved", "online", "offline", "error"],
    },
    platform: {type: String, enum: ["darwin", "linux", "windows"]},
    arch: {type: String},
    version: {type: String},
    hostname: {type: String},
    lastHeartbeatAt: {type: Date},
    config: {type: mongoose.Schema.Types.Mixed, default: {}},
    secrets: {type: mongoose.Schema.Types.Mixed, default: {}},
    capabilities: [{type: String}],
    authTokenHash: {type: String, required: true},
    channelId: {type: mongoose.Schema.Types.ObjectId, ref: "Channel"},
    approvedAt: {type: Date},
    approvedBy: {type: mongoose.Schema.Types.ObjectId, ref: "User"},
    pendingCommands: [
      {
        commandId: {type: String, required: true},
        type: {type: String, required: true},
        payload: {type: mongoose.Schema.Types.Mixed, default: {}},
        queuedAt: {type: Date, default: Date.now},
      },
    ],
    lastCommandResults: [
      {
        commandId: {type: String, required: true},
        success: {type: Boolean, required: true},
        error: {type: String},
        completedAt: {type: Date},
      },
    ],
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

edgeAgentSchema.index({status: 1});
edgeAgentSchema.index({agentType: 1});
edgeAgentSchema.index({lastHeartbeatAt: 1});

addDefaultPlugins(edgeAgentSchema);

export const EdgeAgent = mongoose.model<EdgeAgentDocument, EdgeAgentModel>(
  "EdgeAgent",
  edgeAgentSchema
);
