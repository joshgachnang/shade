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
import {frameAnalysisRoutes} from "./api/frameAnalyses";
import {frameRoutes} from "./api/frames";
import {groupRoutes} from "./api/groups";
import {HealthPlugin} from "./api/health";
import {messageRoutes} from "./api/messages";
import {MovieActionsPlugin, movieRoutes} from "./api/movies";
import {pluginRoutes} from "./api/plugins";
import {radioStreamRoutes} from "./api/radioStreams";
import {remoteAgentRoutes} from "./api/remoteAgents";
import {scheduledTaskRoutes} from "./api/scheduledTasks";
import {SearchPlugin} from "./api/search";
import {taskRunLogRoutes} from "./api/taskRunLogs";
import {transcriptRoutes} from "./api/transcripts";
import {userRoutes} from "./api/users";
import {webhookSourceRoutes} from "./api/webhookSources";
import {AppConfig, loadAppConfig} from "./models/appConfig";
import {User} from "./models/user";
import {startOrchestrator} from "./orchestrator";
import {logError} from "./orchestrator/errors";
import {connectToMongoDB} from "./utils/database";
import {initDirectories} from "./utils/directories";

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

  const adminApp = new AdminApp({
    models: [
      {
        model: AppConfig,
        routePath: "/app-configs",
        displayName: "App Config",
        listFields: ["assistantName", "triggerPattern", "created"],
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
    .register(webhookSourceRoutes)
    .register(movieRoutes)
    .register(frameRoutes)
    .register(frameAnalysisRoutes)
    .register(characterRoutes)
    .register(new MovieActionsPlugin())
    .register(new SearchPlugin())
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
