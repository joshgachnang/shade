import type mongoose from "mongoose";
import type { DefaultDoc, DefaultModel, DefaultStatics } from "./userTypes";

export interface AgentSessionFields {
  groupId: mongoose.Types.ObjectId;
  sessionId: string;
  transcriptPath: string;
  status: "active" | "closed" | "archived";
  messageCount: number;
  lastActivityAt?: Date;
  resumeSessionAt?: string;
}

export type AgentSessionDocument = DefaultDoc & AgentSessionFields;
export type AgentSessionStatics = DefaultStatics<AgentSessionDocument>;
export type AgentSessionModel = DefaultModel<AgentSessionDocument> & AgentSessionStatics;
export type AgentSessionSchema = mongoose.Schema<AgentSessionDocument, AgentSessionModel>;
