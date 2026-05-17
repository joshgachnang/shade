import mongoose from "mongoose";
import type {EdgeAgentEventDocument, EdgeAgentEventModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const edgeAgentEventSchema = new mongoose.Schema<EdgeAgentEventDocument, EdgeAgentEventModel>(
  {
    agentId: {type: mongoose.Schema.Types.ObjectId, ref: "EdgeAgent", required: true, index: true},
    eventType: {type: String, required: true},
    payload: {type: mongoose.Schema.Types.Mixed, default: {}},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

edgeAgentEventSchema.index({agentId: 1, created: 1});

addDefaultPlugins(edgeAgentEventSchema);

export const EdgeAgentEvent = mongoose.model<EdgeAgentEventDocument, EdgeAgentEventModel>(
  "EdgeAgentEvent",
  edgeAgentEventSchema
);
