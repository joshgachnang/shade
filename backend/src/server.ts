import * as Sentry from "@sentry/node";
import {AdminApp} from "@terreno/admin-backend";
import {checkModelsStrict, logger, TerrenoApp} from "@terreno/api";
import {agentSessionRoutes} from "./api/agentSessions";
import {aiRequestRoutes} from "./api/aiRequests";
import {appConfigRoutes} from "./api/appConfig";
import {AppleCalendarPlugin, calendarConfigRoutes} from "./api/appleCalendar";
import {AppleContactsPlugin} from "./api/appleContacts";
import {channelRoutes} from "./api/channels";
import {characterRoutes} from "./api/characters";
import {CommandPlugin} from "./api/command";
import {commandClassificationRoutes} from "./api/commandClassifications";
import {FeatureActionsPlugin, featureRoutes} from "./api/features";
import {frameAnalysisRoutes} from "./api/frameAnalyses";
import {frameRoutes} from "./api/frames";
import {groupRoutes} from "./api/groups";
import {HealthPlugin} from "./api/health";
import {messageRoutes} from "./api/messages";
import {MovieActionsPlugin, movieRoutes} from "./api/movies";
import {NotificationsPlugin} from "./api/notifications";
import {OrchestratorPreviewPlugin} from "./api/orchestratorPreview";
import {pluginRoutes} from "./api/plugins";
import {radioStreamRoutes} from "./api/radioStreams";
import {remoteAgentRoutes} from "./api/remoteAgents";
import {scheduledTaskRoutes} from "./api/scheduledTasks";
import {SearchPlugin} from "./api/search";
import {taskRunLogRoutes} from "./api/taskRunLogs";
import {RecordingsPlugin, transcriptRoutes} from "./api/transcripts";
import {TriviaAutoSearchPlugin} from "./api/triviaAutoSearch";
import {userRoutes} from "./api/users";
import {webhookSourceRoutes} from "./api/webhookSources";
import {AgentSession} from "./models/agentSession";
import {AIRequest} from "./models/aiRequest";
import {AppConfig, loadAppConfig} from "./models/appConfig";
import {CalendarConfig} from "./models/calendarConfig";
import {Channel} from "./models/channel";
import {Character} from "./models/character";
import {CommandClassification} from "./models/commandClassification";
import {Feature} from "./models/feature";
import {Frame} from "./models/frame";
import {FrameAnalysis} from "./models/frameAnalysis";
import {Group} from "./models/group";
import {Message} from "./models/message";
import {Movie} from "./models/movie";
import {Plugin} from "./models/plugin";
import {PrWatch} from "./models/prWatch";
import {RadioStream} from "./models/radioStream";
import {RemoteAgent} from "./models/remoteAgent";
import {ScheduledTask} from "./models/scheduledTask";
import {TaskRunLog} from "./models/taskRunLog";
import {Transcript} from "./models/transcript";
import {TriviaQuestion} from "./models/triviaQuestion";
import {TriviaScore} from "./models/triviaScore";
import {User} from "./models/user";
import {WebhookSource} from "./models/webhookSource";
import {startOrchestrator} from "./orchestrator";
import {logError} from "./orchestrator/errors";
import {createSearchIndexesRunner} from "./scripts/createSearchIndex";
import {seedRadioStreamRunner} from "./scripts/seedRadioStream";
import {connectToMongoDB} from "./utils/database";
import {initDirectories} from "./utils/directories";

const isDeployed = process.env.NODE_ENV === "production";

// Global error handlers — prevent uncaught errors from crashing the process
process.on("uncaughtException", (error) => {
  Sentry.captureException(error);
  logError("Uncaught exception (process will continue)", error);
});

process.on("unhandledRejection", (reason, _promise) => {
  Sentry.captureException(reason);
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

  const adminApp = new AdminApp({
    models: [
      {
        model: AppConfig,
        routePath: "/app-configs",
        displayName: "App Config",
        listFields: ["assistantName", "triggerPattern", "created"],
      },
      {
        model: User,
        routePath: "/users",
        displayName: "Users",
        listFields: ["email", "name", "admin", "created"],
        hiddenFields: ["hash", "salt"],
      },
      {
        model: Group,
        routePath: "/groups",
        displayName: "Groups",
        listFields: ["name", "folder", "trigger", "isMain"],
      },
      {
        model: Channel,
        routePath: "/channels",
        displayName: "Channels",
        listFields: ["name", "type", "status", "privileged"],
      },
      {
        model: Message,
        routePath: "/messages",
        displayName: "Messages",
        listFields: ["sender", "content", "isFromBot", "processedAt"],
      },
      {
        model: Feature,
        routePath: "/features",
        displayName: "Features",
        listFields: ["name", "status", "order", "completedAt"],
      },
      {
        model: Movie,
        routePath: "/movies",
        displayName: "Movies",
        listFields: ["title", "duration", "fps", "frameCount"],
      },
      {
        model: Plugin,
        routePath: "/plugins",
        displayName: "Plugins",
        listFields: ["name", "enabled", "version", "path"],
      },
      {
        model: Character,
        routePath: "/characters",
        displayName: "Characters",
        listFields: ["name", "actorName", "movieId", "firstSeen"],
      },
      {
        model: RadioStream,
        routePath: "/radio-streams",
        displayName: "Radio Streams",
        listFields: ["name", "streamUrl", "status", "targetGroupId"],
      },
      {
        model: AgentSession,
        routePath: "/agent-sessions",
        displayName: "Agent Sessions",
        listFields: ["sessionId", "status", "messageCount", "lastActivityAt"],
      },
      {
        model: AIRequest,
        routePath: "/ai-requests",
        displayName: "AI Requests",
        listFields: ["aiModel", "costUsd", "error", "created"],
      },
      {
        model: CalendarConfig,
        routePath: "/calendar-configs",
        displayName: "Calendar Configs",
        listFields: ["name", "enabledCalendars", "owner", "created"],
      },
      {
        model: CommandClassification,
        routePath: "/command-classifications",
        displayName: "Command Classifications",
        listFields: ["pattern", "routeTo", "priority", "description"],
      },
      {
        model: Frame,
        routePath: "/frames",
        displayName: "Frames",
        listFields: ["movieId", "frameNumber", "timestamp", "imagePath"],
      },
      {
        model: FrameAnalysis,
        routePath: "/frame-analyses",
        displayName: "Frame Analyses",
        listFields: ["frameId", "movieId", "timestamp", "sceneDescription"],
      },
      {
        model: PrWatch,
        routePath: "/pr-watches",
        displayName: "PR Watches",
        listFields: ["reviewer", "state", "isBot", "submittedAt"],
      },
      {
        model: RemoteAgent,
        routePath: "/remote-agents",
        displayName: "Remote Agents",
        listFields: ["name", "status", "lastHeartbeatAt", "created"],
      },
      {
        model: ScheduledTask,
        routePath: "/scheduled-tasks",
        displayName: "Scheduled Tasks",
        listFields: ["name", "scheduleType", "schedule", "status"],
      },
      {
        model: TaskRunLog,
        routePath: "/task-run-logs",
        displayName: "Task Run Logs",
        listFields: ["taskId", "modelBackend", "modelName", "created"],
      },
      {
        model: Transcript,
        routePath: "/transcripts",
        displayName: "Transcripts",
        listFields: ["radioStreamId", "content", "durationMs", "created"],
      },
      {
        model: TriviaQuestion,
        routePath: "/trivia-questions",
        displayName: "Trivia Questions",
        listFields: ["year", "hour", "questionNumber", "answer"],
      },
      {
        model: TriviaScore,
        routePath: "/trivia-scores",
        displayName: "Trivia Scores",
        listFields: ["year", "hour", "place", "teamName", "score"],
      },
      {
        model: WebhookSource,
        routePath: "/webhook-sources",
        displayName: "Webhook Sources",
        listFields: ["name", "type", "groupId", "endpoint"],
      },
    ],
    scripts: [
      {
        name: "createSearchIndexes",
        description:
          "Create MongoDB Atlas Search indexes for FrameAnalysis (requires Atlas cluster).",
        runner: createSearchIndexesRunner,
      },
      {
        name: "seedRadioStream",
        description: "Seed the 90FM Trivia radio stream if it does not already exist.",
        runner: seedRadioStreamRunner,
      },
    ],
  });

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
    .register(new RecordingsPlugin())
    .register(webhookSourceRoutes)
    .register(movieRoutes)
    .register(featureRoutes)
    .register(new FeatureActionsPlugin())
    .register(frameRoutes)
    .register(frameAnalysisRoutes)
    .register(characterRoutes)
    .register(new MovieActionsPlugin())
    .register(new SearchPlugin())
    .register(new AppleCalendarPlugin())
    .register(calendarConfigRoutes)
    .register(new AppleContactsPlugin())
    .register(new TriviaAutoSearchPlugin())
    .register(new NotificationsPlugin())
    .register(new OrchestratorPreviewPlugin())
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
