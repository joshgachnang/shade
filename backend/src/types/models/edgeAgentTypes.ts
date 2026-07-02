import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface EdgeAgentPendingCommand {
  commandId: string;
  type: string;
  payload: Record<string, unknown>;
  queuedAt: Date;
}

export interface EdgeAgentCommandResult {
  commandId: string;
  success: boolean;
  error?: string;
  completedAt?: Date;
}

export interface EdgeAgentFields {
  name: string;
  agentType: string;
  status: "pending" | "approved" | "online" | "offline" | "error";
  platform?: "darwin" | "linux" | "windows";
  arch?: string;
  version?: string;
  hostname?: string;
  lastHeartbeatAt?: Date;
  config: Record<string, unknown>;
  secrets: Record<string, unknown>;
  capabilities: string[];
  authTokenHash: string;
  channelId?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  approvedBy?: mongoose.Types.ObjectId;
  pendingCommands: EdgeAgentPendingCommand[];
  lastCommandResults: EdgeAgentCommandResult[];
}

export type EdgeAgentDocument = DefaultDoc & EdgeAgentFields;
export type EdgeAgentStatics = DefaultStatics<EdgeAgentDocument>;
export type EdgeAgentModel = DefaultModel<EdgeAgentDocument> & EdgeAgentStatics;
export type EdgeAgentSchema = mongoose.Schema<EdgeAgentDocument, EdgeAgentModel>;
