import mongoose from "mongoose";
import type {AIRequestDocument, AIRequestModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const aiRequestSchema = new mongoose.Schema<AIRequestDocument, AIRequestModel>(
  {
    aiModel: {type: String, required: true},
    costUsd: {type: Number},
    error: {type: String},
    groupId: {type: mongoose.Schema.Types.ObjectId, ref: "Group"},
    metadata: {type: mongoose.Schema.Types.Mixed},
    prompt: {type: String, required: true},
    requestType: {type: String, required: true},
    response: {type: String},
    responseTime: {type: Number},
    sessionId: {type: String},
    status: {type: String, required: true, enum: ["completed", "failed", "timeout"]},
    tokensUsed: {type: Number},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

aiRequestSchema.index({created: -1});
aiRequestSchema.index({aiModel: 1, created: -1});
aiRequestSchema.index({groupId: 1, created: -1});
aiRequestSchema.index({status: 1, created: -1});

addDefaultPlugins(aiRequestSchema);

export const AIRequest = mongoose.model<AIRequestDocument, AIRequestModel>(
  "AIRequest",
  aiRequestSchema
);
