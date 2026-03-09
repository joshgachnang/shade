import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface AIRequestFields {
  aiModel: string;
  costUsd?: number;
  error?: string;
  groupId?: mongoose.Types.ObjectId;
  metadata?: Record<string, unknown>;
  prompt: string;
  requestType: string;
  response?: string;
  responseTime?: number;
  sessionId?: string;
  status: "completed" | "failed" | "timeout";
  tokensUsed?: number;
}

export type AIRequestDocument = DefaultDoc & AIRequestFields;
export type AIRequestStatics = DefaultStatics<AIRequestDocument>;
export type AIRequestModel = DefaultModel<AIRequestDocument> & AIRequestStatics;
export type AIRequestSchema = mongoose.Schema<AIRequestDocument, AIRequestModel>;
