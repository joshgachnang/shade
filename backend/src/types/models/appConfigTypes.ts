import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface AppConfigPollIntervals {
  message: number;
  task: number;
  scheduler: number;
  ipc: number;
  imessage: number;
}

export interface AppConfigConcurrency {
  maxGlobal: number;
}

export interface AppConfigRadioTranscriber {
  enabled: boolean;
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
  /** Global default agent model; empty string = Agent SDK default. */
  model: string;
  /** Cheap/fast model tier for auxiliary work (e.g. trivia detection). */
  auxiliaryModel: string;
  maxTurns: number;
  progressIntervalMs: number;
  allowedTools: string[];
  enableSubagents: boolean;
}

export interface AppConfigMemory {
  enabled: boolean;
  maxFileChars: number;
  maxSkillChars: number;
  historySearchLimit: number;
}

export interface AppConfigTaskWorker {
  enabled: boolean;
  concurrency: number;
  pollMs: number;
  heartbeatMs: number;
  staleMs: number;
  taskTimeoutMs: number;
  runInGateway: boolean;
}

export interface AppConfigScheduler {
  useTaskBoard: boolean;
}

export interface AppConfigApiKeys {
  braveSearch: string;
  exa: string;
  tavily: string;
  anthropic: string;
  openRouter: string;
  openai: string;
  deepgram: string;
  acrCloudAccessKey: string;
  acrCloudSecretKey: string;
  github: string;
}

export interface AppConfigPrWatchPrompts {
  fixConflicts: string;
  checkWatcher: string;
  botReviewSystem: string;
}

export interface AppConfigPrWatch {
  enabled: boolean;
  groupId: string;
  pollIntervalMs: number;
  githubUsername: string;
  autoRespondToBots: boolean;
  autoFixConflicts: boolean;
  reposBaseDir: string;
  botResponseModel: string;
  prompts: AppConfigPrWatchPrompts;
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
  planner: string;
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

export interface AppConfigNotifications {
  enabled: boolean;
  slackChannel: string;
}

export interface AppConfigRichResponses {
  enabled: boolean;
  autoTruncate: boolean;
}

export interface AppConfigMaps {
  mapboxAccessToken: string;
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
  memory: AppConfigMemory;
  taskWorker: AppConfigTaskWorker;
  scheduler: AppConfigScheduler;
  apiKeys: AppConfigApiKeys;
  models: AppConfigModels;
  mcpMedia: AppConfigMcpMedia;
  prWatch: AppConfigPrWatch;
  triviaMonitor: AppConfigTriviaMonitor;
  triviaStats: AppConfigTriviaStats;
  notifications: AppConfigNotifications;
  richResponses: AppConfigRichResponses;
  maps: AppConfigMaps;
}

export type AppConfigDocument = DefaultDoc & AppConfigFields;
export type AppConfigStatics = DefaultStatics<AppConfigDocument>;
export type AppConfigModel = DefaultModel<AppConfigDocument> & AppConfigStatics;
export type AppConfigSchema = mongoose.Schema<AppConfigDocument, AppConfigModel>;
