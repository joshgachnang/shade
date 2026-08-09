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

export interface AppConfigBuiltinTaskSettings {
  enabled: boolean;
  /** 5-field cron expression, evaluated in server time. */
  cron: string;
}

export interface AppConfigBuiltinTasks {
  dailyTriage: AppConfigBuiltinTaskSettings;
  sessionReview: AppConfigBuiltinTaskSettings;
}

export interface AppConfigSessionReview {
  lookbackHours: number;
  /** Task runs at or over this duration are flagged. */
  longRunMs: number;
  /** Sessions with at least this many messages are flagged. */
  longSessionMessages: number;
  /** Sessions whose summed AIRequest cost meets this are flagged. */
  sessionCostUsd: number;
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

/**
 * One git-backed infrastructure repo the Infra Bot is allowed to modify.
 * The set of these repos IS the blast radius — anything not listed is refused.
 */
export interface AppConfigInfraRepo {
  /** Short handle used in tool calls (e.g. "docker-stacks"). */
  name: string;
  /** Clone URL. For github.com hosts the API token is injected at runtime. */
  gitUrl: string;
  /** GitHub owner/org, used to open the pull request. */
  owner: string;
  /** GitHub repo name, used to open the pull request. */
  repo: string;
  /** Branch GitOps deploys from. The bot branches off it but never pushes to it. */
  deployBranch: string;
  /** What this repo controls, shown to the agent when it lists repos. */
  description: string;
}

export interface AppConfigInfraBot {
  enabled: boolean;
  /** Group that may use the infra-bot capability / receives its notifications. */
  groupId: string;
  /** Isolated working dir where managed repos are cloned. The bot only ever
   * touches git here — it never reaches the running services. */
  reposBaseDir: string;
  /** Git identity for commits the bot authors. */
  gitUserName: string;
  gitUserEmail: string;
  /** How often (ms) the InfraWatcher polls open infra PRs for status changes. */
  watchPollIntervalMs: number;
  /** Every feature branch the bot creates lives under this prefix. It can only
   * push branches under this prefix — never a repo's deploy branch. */
  branchPrefix: string;
  /** Allowlist of repos the bot may modify. This list is the blast radius. */
  repos: AppConfigInfraRepo[];
}

export interface AppConfigIMessage {
  /** Handles allowed to receive replies over iMessage/SMS; empty = reply to no one. */
  replyAllowlist: string[];
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

export interface AppConfigTestMode {
  echoFallback: boolean;
  simulateLatencyMs: number;
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
  builtinTasks: AppConfigBuiltinTasks;
  sessionReview: AppConfigSessionReview;
  apiKeys: AppConfigApiKeys;
  models: AppConfigModels;
  mcpMedia: AppConfigMcpMedia;
  prWatch: AppConfigPrWatch;
  infraBot: AppConfigInfraBot;
  imessage: AppConfigIMessage;
  triviaMonitor: AppConfigTriviaMonitor;
  triviaStats: AppConfigTriviaStats;
  notifications: AppConfigNotifications;
  richResponses: AppConfigRichResponses;
  maps: AppConfigMaps;
  testMode: AppConfigTestMode;
}

export type AppConfigDocument = DefaultDoc & AppConfigFields;
export type AppConfigStatics = DefaultStatics<AppConfigDocument>;
export type AppConfigModel = DefaultModel<AppConfigDocument> & AppConfigStatics;
export type AppConfigSchema = mongoose.Schema<AppConfigDocument, AppConfigModel>;
