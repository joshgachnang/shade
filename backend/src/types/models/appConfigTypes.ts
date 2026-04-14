import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface AppConfigPollIntervals {
  message: number;
  task: number;
  ipc: number;
  imessage: number;
}

export interface AppConfigConcurrency {
  maxGlobal: number;
}

export interface AppConfigRadioTranscriber {
  defaultBatchIntervalMs: number;
  maxReconnectAttempts: number;
  reconnectDelayMs: number;
}

export interface AppConfigOrchestrator {
  baseRetryDelayMs: number;
  maxRetries: number;
  maxResumes: number;
  progressMessageIntervalMs: number;
  conversationWindowMs: number;
}

export interface AppConfigAgent {
  maxTurns: number;
  progressIntervalMs: number;
  allowedTools: string[];
}

export interface AppConfigApiKeys {
  braveSearch: string;
  exa: string;
  tavily: string;
}

export interface AppConfigTriviaAutoSearch {
  enabled: boolean;
  groupId: string;
  allowedUserIds: string[];
}

export interface AppConfigPrWatch {
  enabled: boolean;
  groupId: string;
  pollIntervalMs: number;
  githubUsername: string;
  autoRespondToBots: boolean;
  autoFixConflicts: boolean;
  reposBaseDir: string;
}

export interface AppConfigFields {
  assistantName: string;
  triggerPattern: string;
  pollIntervals: AppConfigPollIntervals;
  concurrency: AppConfigConcurrency;
  radioTranscriber: AppConfigRadioTranscriber;
  orchestrator: AppConfigOrchestrator;
  agent: AppConfigAgent;
  apiKeys: AppConfigApiKeys;
  triviaAutoSearch: AppConfigTriviaAutoSearch;
  prWatch: AppConfigPrWatch;
}

export type AppConfigDocument = DefaultDoc & AppConfigFields;
export type AppConfigStatics = DefaultStatics<AppConfigDocument>;
export type AppConfigModel = DefaultModel<AppConfigDocument> & AppConfigStatics;
export type AppConfigSchema = mongoose.Schema<AppConfigDocument, AppConfigModel>;
