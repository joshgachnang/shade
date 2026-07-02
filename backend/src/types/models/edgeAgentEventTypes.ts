import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface EdgeAgentEventFields {
  agentId: mongoose.Types.ObjectId;
  eventType: string;
  payload: Record<string, unknown>;
}

export type EdgeAgentEventDocument = DefaultDoc & EdgeAgentEventFields;
export type EdgeAgentEventStatics = DefaultStatics<EdgeAgentEventDocument>;
export type EdgeAgentEventModel = DefaultModel<EdgeAgentEventDocument> & EdgeAgentEventStatics;
export type EdgeAgentEventSchema = mongoose.Schema<EdgeAgentEventDocument, EdgeAgentEventModel>;
