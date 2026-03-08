import {checkModelsStrict, logger, TerrenoApp} from "@terreno/api";
import {agentSessionRoutes} from "./api/agentSessions";
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
import {connectToMongoDB} from "./utils/database";
import {initDirectories} from "./utils/directories";

const isDeployed = process.env.NODE_ENV === "production";

export const start = async (skipListen = false) => {
  await connectToMongoDB();
  await initDirectories();

  logger.info(`Starting Shade server on port ${process.env.PORT || 4020}`);

  if (!isDeployed) {
    checkModelsStrict();
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
    .register(remoteAgentRoutes)
    .register(commandClassificationRoutes)
    .register(pluginRoutes)
    .register(webhookSourceRoutes)
    .start();

  if (!skipListen) {
    startOrchestrator(app).catch((err) => {
      logger.error(`Failed to start orchestrator: ${err}`);
    });
  }

  return app;
};

if (process.env.NODE_ENV !== "test") {
  start().catch((error) => {
    logger.error(`Fatal error starting server: ${error}`);
  });
}
