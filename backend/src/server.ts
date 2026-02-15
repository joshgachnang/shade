import {type AddRoutes, checkModelsStrict, logger, setupServer} from "@terreno/api";
import {addUserRoutes} from "./api/users";
import {User} from "./models/user";
import {connectToMongoDB} from "./utils/database";

const isDeployed = process.env.NODE_ENV === "production";

const addMiddleware: AddRoutes = (_router, _options) => {
  // Add middleware here
};

const addRoutes: AddRoutes = (router, options): void => {
  // Add API routes
  addUserRoutes(router, options);
};

export async function start(skipListen = false): Promise<ReturnType<typeof setupServer>> {
  await connectToMongoDB();

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
    // biome-ignore lint/suspicious/noExplicitAny: Typing User model
    userModel: User as any,
  });

  return app;
}

start().catch((error) => {
  logger.error(`Fatal error starting server: ${error}`);
});
