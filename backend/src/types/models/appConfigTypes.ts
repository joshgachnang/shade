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
  postTranscriptsToSlack: boolean;
  songIdentification: boolean;
  postSongIdToSlack: boolean;
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
  anthropic: string;
  openRouter: string;
  deepgram: string;
  acrCloudAccessKey: string;
  acrCloudSecretKey: string;
  github: string;
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

export interface AppConfigTriviaMonitor {
  enabled: boolean;
  groupId: string;
  allowedUserIds: string[];
  questionsWebhook: string;
  answersWebhook: string;
}

export interface AppConfigTriviaStats {
  slackWebhook: string;
  blueskyIdentifier: string;
  blueskyPassword: string;
}

export interface AppConfigModels {
  answerer: string;
  detector: string;
}

export interface AppConfigMcpServiceConfig {
  baseUrl: string;
  apiKey: string;
}

export interface AppConfigMcpNzbgetConfig {
  baseUrl: string;
  username: string;
  password: string;
}

export interface AppConfigMcpPlexConfig {
  baseUrl: string;
  token: string;
}

export interface AppConfigMcpMedia {
  authToken: string;
  port: number;
  sonarr: AppConfigMcpServiceConfig;
  radarr: AppConfigMcpServiceConfig;
  nzbget: AppConfigMcpNzbgetConfig;
  plex: AppConfigMcpPlexConfig;
}

export interface AppConfigLogging {
  level: string;
}

export interface AppConfigAuth {
  tokenSecret: string;
  refreshTokenSecret: string;
}

export interface AppConfigFields {
  assistantName: string;
  triggerPattern: string;
  dataDir: string;
  publicUrl: string;
  triviaResearchSystemPrompt: string;
  logging: AppConfigLogging;
  auth: AppConfigAuth;
  pollIntervals: AppConfigPollIntervals;
  concurrency: AppConfigConcurrency;
  radioTranscriber: AppConfigRadioTranscriber;
  orchestrator: AppConfigOrchestrator;
  agent: AppConfigAgent;
  apiKeys: AppConfigApiKeys;
  models: AppConfigModels;
  mcpMedia: AppConfigMcpMedia;
  prWatch: AppConfigPrWatch;
  triviaMonitor: AppConfigTriviaMonitor;
  triviaStats: AppConfigTriviaStats;
}

export type AppConfigDocument = DefaultDoc & AppConfigFields;
export type AppConfigStatics = DefaultStatics<AppConfigDocument>;
export type AppConfigModel = DefaultModel<AppConfigDocument> & AppConfigStatics;
export type AppConfigSchema = mongoose.Schema<AppConfigDocument, AppConfigModel>;
