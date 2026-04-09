import {AdminApp} from "@terreno/admin-backend";
import {checkModelsStrict, logger, TerrenoApp} from "@terreno/api";
import {agentSessionRoutes} from "./api/agentSessions";
import {aiRequestRoutes} from "./api/aiRequests";
import {appConfigRoutes} from "./api/appConfig";
import {AppleCalendarPlugin, calendarConfigRoutes} from "./api/appleCalendar";
import {AppleContactsPlugin} from "./api/appleContacts";
import {channelRoutes} from "./api/channels";
import {CommandPlugin} from "./api/command";
import {commandClassificationRoutes} from "./api/commandClassifications";
import {groupRoutes} from "./api/groups";
import {HealthPlugin} from "./api/health";
import {messageRoutes} from "./api/messages";
import {pluginRoutes} from "./api/plugins";
import {radioStreamRoutes} from "./api/radioStreams";
import {remoteAgentRoutes} from "./api/remoteAgents";
import {scheduledTaskRoutes} from "./api/scheduledTasks";
import {taskRunLogRoutes} from "./api/taskRunLogs";
import {transcriptRoutes} from "./api/transcripts";
import {userRoutes} from "./api/users";
import {webhookSourceRoutes} from "./api/webhookSources";
import {
  AgentSession,
  AIRequest,
  AppConfig,
  CalendarConfig,
  Channel,
  CommandClassification,
  Group,
  loadAppConfig,
  Message,
  Plugin,
  RadioStream,
  RemoteAgent,
  ScheduledTask,
  TaskRunLog,
  Transcript,
  TriviaQuestion,
  TriviaScore,
  WebhookSource,
} from "./models";
import {User} from "./models/user";
import {startOrchestrator} from "./orchestrator";
import {logError} from "./orchestrator/errors";
import {connectToMongoDB} from "./utils/database";
import {initDirectories} from "./utils/directories";

const adminApp = new AdminApp({
  models: [
    {
      model: User,
      routePath: "/users",
      displayName: "Users",
      listFields: ["name", "email", "admin", "created"],
    },
    {
      model: Channel,
      routePath: "/channels",
      displayName: "Channels",
      listFields: ["name", "type", "status", "lastConnectedAt", "created"],
    },
    {
      model: Group,
      routePath: "/groups",
      displayName: "Groups",
      listFields: ["name", "folder", "isMain", "created"],
    },
    {
      model: Message,
      routePath: "/messages",
      displayName: "Messages",
      listFields: ["sender", "content", "isFromBot", "created"],
    },
    {
      model: AIRequest,
      routePath: "/aiRequests",
      displayName: "AI Requests",
      listFields: [
        "aiModel",
        "requestType",
        "status",
        "costUsd",
        "tokensUsed",
        "responseTime",
        "created",
      ],
    },
    {
      model: AgentSession,
      routePath: "/agentSessions",
      displayName: "Agent Sessions",
      listFields: ["sessionId", "status", "messageCount", "lastActivityAt", "created"],
    },
    {
      model: ScheduledTask,
      routePath: "/scheduledTasks",
      displayName: "Scheduled Tasks",
      listFields: [
        "name",
        "scheduleType",
        "schedule",
        "status",
        "nextRunAt",
        "lastRunAt",
        "runCount",
      ],
    },
    {
      model: TaskRunLog,
      routePath: "/taskRunLogs",
      displayName: "Task Run Logs",
      listFields: ["trigger", "modelBackend", "modelName", "status", "durationMs", "startedAt"],
    },
    {
      model: RemoteAgent,
      routePath: "/remoteAgents",
      displayName: "Remote Agents",
      listFields: ["name", "status", "lastHeartbeatAt", "created"],
    },
    {
      model: CommandClassification,
      routePath: "/commandClassifications",
      displayName: "Command Classifications",
      listFields: ["pattern", "classification", "routeTo", "priority"],
    },
    {
      model: Plugin,
      routePath: "/plugins",
      displayName: "Plugins",
      listFields: ["name", "enabled", "version", "created"],
    },
    {
      model: WebhookSource,
      routePath: "/webhookSources",
      displayName: "Webhook Sources",
      listFields: ["name", "type", "enabled", "classification", "lastReceivedAt"],
    },
    {
      model: CalendarConfig,
      routePath: "/calendar-configs",
      displayName: "Calendar Configs",
      listFields: ["created", "updated"],
    },
    {
      model: AppConfig,
      routePath: "/app-configs",
      displayName: "App Config",
      listFields: ["created", "updated"],
    },
    {
      model: RadioStream,
      routePath: "/radioStreams",
      displayName: "Radio Streams",
      listFields: ["name", "status", "created"],
    },
    {
      model: Transcript,
      routePath: "/transcripts",
      displayName: "Transcripts",
      listFields: ["durationMs", "created"],
    },
    {
      model: TriviaQuestion,
      routePath: "/triviaQuestions",
      displayName: "Trivia Questions",
      listFields: ["year", "hour", "questionNumber", "questionText"],
    },
    {
      model: TriviaScore,
      routePath: "/triviaScores",
      displayName: "Trivia Scores",
      listFields: ["year", "hour", "place", "teamName", "score"],
    },
  ],
});

const isDeployed = process.env.NODE_ENV === "production";

// Global error handlers — prevent uncaught errors from crashing the process
process.on("uncaughtException", (error) => {
  logError("Uncaught exception (process will continue)", error);
});

process.on("unhandledRejection", (reason, _promise) => {
  logError("Unhandled promise rejection", reason);
});

export const start = async (skipListen = false) => {
  logger.info("Shade server starting up...");

  await connectToMongoDB();
  logger.info("MongoDB connected, initializing directories...");

  await initDirectories();
  logger.info("Directories initialized, loading app config...");

  await loadAppConfig();
  logger.info("App config loaded, configuring server...");

  logger.info(`Starting Shade server on port ${process.env.PORT || 4020}`);

  if (!isDeployed) {
    try {
      checkModelsStrict();
    } catch (err) {
      logger.error(`Model validation failed (non-fatal): ${err}`);
    }
  }

  const app = new TerrenoApp({
    userModel: User as any,
    loggingOptions: {
      disableConsoleColors: isDeployed,
      level: "debug",
    },
    logRequests: !isDeployed,
    skipListen,
  })
    .register(new HealthPlugin())
    .register(new CommandPlugin())
    .register(userRoutes)
    .register(channelRoutes)
    .register(groupRoutes)
    .register(messageRoutes)
    .register(scheduledTaskRoutes)
    .register(taskRunLogRoutes)
    .register(agentSessionRoutes)
    .register(aiRequestRoutes)
    .register(remoteAgentRoutes)
    .register(commandClassificationRoutes)
    .register(pluginRoutes)
    .register(radioStreamRoutes)
    .register(transcriptRoutes)
    .register(webhookSourceRoutes)
    .register(new AppleCalendarPlugin())
    .register(calendarConfigRoutes)
    .register(new AppleContactsPlugin())
    .register(appConfigRoutes)
    .register(adminApp)
    .start();

  if (!skipListen) {
    startOrchestrator(app).catch((err) => {
      logError("Failed to start orchestrator", err);
    });
  }

  return app;
};

if (process.env.NODE_ENV !== "test") {
  start().catch((error) => {
    logError("Fatal error starting server", error);
    process.exit(1);
  });
}
