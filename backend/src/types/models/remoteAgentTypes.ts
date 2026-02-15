import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface RemoteAgentConnectionInfo {
  host?: string;
  port?: number;
  platform?: string;
}

export interface RemoteAgentFields {
  name: string;
  capabilities: string[];
  status: "online" | "offline" | "busy";
  lastHeartbeatAt?: Date;
  connectionInfo: RemoteAgentConnectionInfo;
  authToken: string;
}

export type RemoteAgentDocument = DefaultDoc & RemoteAgentFields;
export type RemoteAgentStatics = DefaultStatics<RemoteAgentDocument>;
export type RemoteAgentModel = DefaultModel<RemoteAgentDocument> & RemoteAgentStatics;
export type RemoteAgentSchema = mongoose.Schema<RemoteAgentDocument, RemoteAgentModel>;
