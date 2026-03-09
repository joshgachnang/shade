import {checkModelsStrict, logger, TerrenoApp} from "@terreno/api";
import {agentSessionRoutes} from "./api/agentSessions";
import {aiRequestRoutes} from "./api/aiRequests";
import {channelRoutes} from "./api/channels";
import {CommandPlugin} from "./api/command";
import {commandClassificationRoutes} from "./api/commandClassifications";
import {groupRoutes} from "./api/groups";
import {HealthPlugin} from "./api/health";
import {messageRoutes} from "./api/messages";
import {pluginRoutes} from "./api/plugins";
import {remoteAgentRoutes} from "./api/remoteAgents";
import {scheduledTaskRoutes} from "./api/scheduledTasks";
import {taskRunLogRoutes} from "./api/taskRunLogs";
import {userRoutes} from "./api/users";
import {webhookSourceRoutes} from "./api/webhookSources";
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
  logger.info("Directories initialized, configuring server...");

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
    .register(webhookSourceRoutes)
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
