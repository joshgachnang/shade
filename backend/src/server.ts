import {type AddRoutes, checkModelsStrict, logger, setupServer} from "@terreno/api";
import {addAgentSessionRoutes} from "./api/agentSessions";
import {addChannelRoutes} from "./api/channels";
import {addCommandClassificationRoutes} from "./api/commandClassifications";
import {addGroupRoutes} from "./api/groups";
import {addMessageRoutes} from "./api/messages";
import {addPluginRoutes} from "./api/plugins";
import {addRemoteAgentRoutes} from "./api/remoteAgents";
import {addScheduledTaskRoutes} from "./api/scheduledTasks";
import {addTaskRunLogRoutes} from "./api/taskRunLogs";
import {addUserRoutes} from "./api/users";
import {addWebhookSourceRoutes} from "./api/webhookSources";
import {User} from "./models/user";
import {connectToMongoDB} from "./utils/database";
import {initDirectories} from "./utils/directories";

const isDeployed = process.env.NODE_ENV === "production";

const addMiddleware: AddRoutes = (_router, _options) => {
  // Add middleware here
};

const addRoutes: AddRoutes = (router, options): void => {
  addUserRoutes({router, options});
  addChannelRoutes(router, options);
  addGroupRoutes(router, options);
  addMessageRoutes(router, options);
  addScheduledTaskRoutes(router, options);
  addTaskRunLogRoutes(router, options);
  addAgentSessionRoutes(router, options);
  addRemoteAgentRoutes(router, options);
  addCommandClassificationRoutes(router, options);
  addPluginRoutes(router, options);
  addWebhookSourceRoutes(router, options);
};

export const start = async (skipListen = false): Promise<ReturnType<typeof setupServer>> => {
  await connectToMongoDB();
  await initDirectories();

  logger.info(`Starting Shade server on port ${process.env.PORT || 4020}`);

  if (!isDeployed) {
    checkModelsStrict();
  }

  const app = setupServer({
    addMiddleware,
    addRoutes,
    loggingOptions: {
      disableConsoleColors: isDeployed,
      level: "debug",
      logRequests: !isDeployed,
    },
    skipListen,
    userModel: User as any,
  });

  return app;
};

start().catch((error) => {
  logger.error(`Fatal error starting server: ${error}`);
});
