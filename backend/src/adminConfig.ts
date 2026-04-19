import type {AdminModelConfig} from "@terreno/admin-backend";
import {
  AgentSession,
  AIRequest,
  AppConfig,
  CalendarConfig,
  Channel,
  Character,
  CommandClassification,
  Frame,
  FrameAnalysis,
  Group,
  Message,
  Movie,
  Plugin,
  PrWatch,
  RadioStream,
  RemoteAgent,
  ScheduledTask,
  TaskRunLog,
  Transcript,
  TriviaQuestion,
  TriviaScore,
  User,
  WebhookSource,
} from "./models";

/**
 * Every Mongoose model gets a spot in the admin UI. `listFields` pick the
 * columns most useful at a glance; large blob-ish fields (full prompts, raw
 * responses, hashed passwords) are hidden from the edit form via
 * `hiddenFields` so they don't get accidentally edited.
 *
 * Route paths mirror the public REST paths in `api/crudRoutes.ts` where the
 * two overlap, so admin edits hit the same endpoints as authenticated UI
 * calls and bypass the admin router's IsAdmin-only gate only when appropriate.
 */
export const adminModelConfigs: AdminModelConfig[] = [
  {
    model: AppConfig,
    routePath: "/app-configs",
    displayName: "App Config",
    listFields: ["assistantName", "triggerPattern", "updated"],
  },
  {
    model: User,
    routePath: "/users",
    displayName: "Users",
    listFields: ["email", "name", "admin", "created"],
    // passport-local-mongoose adds `hash` and `salt` for password storage.
    // They should never be surfaced or editable in the admin form.
    hiddenFields: ["hash", "salt"],
  },
  {
    model: Channel,
    routePath: "/channels",
    displayName: "Channels",
    listFields: ["name", "type", "status", "lastConnectedAt"],
    // config blob can hold secrets (tokens, passwords); keep it out of list.
    hiddenFields: [],
  },
  {
    model: Group,
    routePath: "/groups",
    displayName: "Groups",
    listFields: ["name", "channelId", "isMain", "created"],
  },
  {
    model: Message,
    routePath: "/messages",
    displayName: "Messages",
    listFields: ["groupId", "sender", "isFromBot", "processedAt", "created"],
    defaultSort: "-created",
  },
  {
    model: ScheduledTask,
    routePath: "/scheduled-tasks",
    displayName: "Scheduled Tasks",
    listFields: ["name", "groupId", "scheduleType", "schedule", "status", "nextRunAt"],
  },
  {
    model: TaskRunLog,
    routePath: "/task-run-logs",
    displayName: "Task Run Logs",
    listFields: [
      "groupId",
      "taskId",
      "trigger",
      "modelBackend",
      "status",
      "durationMs",
      "startedAt",
    ],
    defaultSort: "-startedAt",
  },
  {
    model: AgentSession,
    routePath: "/agent-sessions",
    displayName: "Agent Sessions",
    listFields: ["sessionId", "groupId", "status", "messageCount", "lastActivityAt"],
    defaultSort: "-lastActivityAt",
  },
  {
    model: AIRequest,
    routePath: "/ai-requests",
    displayName: "AI Requests",
    listFields: [
      "aiModel",
      "requestType",
      "status",
      "tokensUsed",
      "costUsd",
      "responseTime",
      "created",
    ],
    defaultSort: "-created",
  },
  {
    model: RemoteAgent,
    routePath: "/remote-agents",
    displayName: "Remote Agents",
    listFields: ["name", "status", "capabilities"],
  },
  {
    model: CommandClassification,
    routePath: "/command-classifications",
    displayName: "Command Classifications",
    listFields: ["classification", "priority"],
    defaultSort: "-priority",
  },
  {
    model: Plugin,
    routePath: "/plugins",
    displayName: "Plugins",
    listFields: ["name", "enabled", "updated"],
  },
  {
    model: RadioStream,
    routePath: "/radio-streams",
    displayName: "Radio Streams",
    listFields: ["name", "status", "targetGroupId", "lastTranscriptAt"],
  },
  {
    model: WebhookSource,
    routePath: "/webhook-sources",
    displayName: "Webhook Sources",
    listFields: ["name", "type", "enabled", "groupId", "lastReceivedAt"],
  },
  {
    model: CalendarConfig,
    routePath: "/calendar-configs",
    displayName: "Calendar Configs",
    listFields: ["name", "owner", "enabledCalendars"],
  },
  // --- Movie pipeline ---
  {
    model: Movie,
    routePath: "/movies",
    displayName: "Movies",
    listFields: ["title", "status", "duration", "frameCount", "processedFrameCount"],
  },
  {
    model: Frame,
    routePath: "/frames",
    displayName: "Frames",
    listFields: ["movieId", "frameNumber", "timestamp", "status"],
    defaultSort: "timestamp",
  },
  {
    model: FrameAnalysis,
    routePath: "/frame-analyses",
    displayName: "Frame Analyses",
    listFields: ["movieId", "frameId", "timestamp", "mood"],
    defaultSort: "timestamp",
    // rawResponse is bulky JSON from the vision model; keep it out of forms.
    hiddenFields: ["rawResponse"],
  },
  {
    model: Character,
    routePath: "/characters",
    displayName: "Characters",
    listFields: ["movieId", "name", "actorName", "totalAppearances"],
  },
  // --- Radio transcripts ---
  {
    model: Transcript,
    routePath: "/transcripts",
    displayName: "Transcripts",
    listFields: ["radioStreamId", "targetGroupId", "created"],
    defaultSort: "-created",
  },
  // --- PR watcher ---
  {
    model: PrWatch,
    routePath: "/pr-watches",
    displayName: "PR Watches",
    listFields: ["repo", "prNumber", "title", "status", "reviewDecision", "lastChangedAt"],
    defaultSort: "-lastChangedAt",
  },
  // --- Trivia (separate MongoDB connection; read-only in practice) ---
  {
    model: TriviaQuestion,
    routePath: "/trivia-questions",
    displayName: "Trivia Questions",
    listFields: ["year", "hour", "questionNumber", "answer"],
    defaultSort: "-year",
  },
  {
    model: TriviaScore,
    routePath: "/trivia-scores",
    displayName: "Trivia Scores",
    listFields: ["year", "hour", "place", "teamName", "score"],
    defaultSort: "-year",
  },
];
