import * as Sentry from "@sentry/node";
import {AdminApp} from "@terreno/admin-backend";
import {checkModelsStrict, logger, TerrenoApp} from "@terreno/api";
import {AppleCalendarPlugin} from "./api/appleCalendar";
import {AppleContactsPlugin} from "./api/appleContacts";
import {CommandPlugin} from "./api/command";
import {crudRoutes} from "./api/crudRoutes";
import {HealthPlugin} from "./api/health";
import {MovieActionsPlugin} from "./api/movies";
import {SearchPlugin} from "./api/search";
import {RecordingsPlugin} from "./api/transcripts";
import {TriviaAutoSearchPlugin} from "./api/triviaAutoSearch";
import {AppConfig, loadAppConfig} from "./models/appConfig";
import {User} from "./models/user";
import {oapi} from "./openapi";
import {startOrchestrator} from "./orchestrator";
import {logError} from "./orchestrator/errors";
import {hydrateEnvFromConfig} from "./utils/configEnv";
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

  // Boot sequence:
  //   1. Connect to Mongo (needs MONGO_URI env — cannot live in AppConfig).
  //   2. Load AppConfig and hydrate `process.env` from it, so anything that
  //      reads env below (TerrenoApp JWT setup, filesystem paths, public URL)
  //      sees values sourced from AppConfig as fallbacks.
  //   3. Init filesystem dirs (uses hydrated SHADE_DATA_DIR via config.ts).
  //   4. Build the HTTP app and orchestrator.
  // TerrenoApp logs "Listening on port N" once the HTTP server binds.
  await connectToMongoDB();
  const appConfig = await loadAppConfig();
  hydrateEnvFromConfig(appConfig);
  await initDirectories();

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

  // AdminApp.register takes an optional oapi instance to thread into its
  // model routers; TerrenoApp's plugin interface only passes `app`, so we wrap
  // AdminApp in a thin TerrenoPlugin that forwards the shared oapi instance.
  // Without this, AdminApp's modelRouter calls trigger
  // "No options.openApi provided, skipping *OpenApiMiddleware" debug logs.
  const adminPlugin = {
    register(app: Parameters<typeof adminApp.register>[0]): void {
      adminApp.register(app, oapi);
    },
  };

  type LogLevel = "debug" | "info" | "warn" | "error";
  const validLevels: readonly LogLevel[] = ["debug", "info", "warn", "error"];
  const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
  const logLevel: LogLevel =
    envLevel && validLevels.includes(envLevel) ? envLevel : isDeployed ? "info" : "debug";

  const builder = new TerrenoApp({
    userModel: User as any,
    loggingOptions: {
      disableConsoleColors: isDeployed,
      level: logLevel,
    },
    logRequests: !isDeployed,
    skipListen,
  })
    // Mount our shared OpenAPI middleware before anything else registers so
    // `/openapi.json` serves the spec populated by `modelRouter()` calls
    // rather than TerrenoApp's empty internal instance.
    .addMiddleware(oapi)
    .register(new HealthPlugin())
    .register(new CommandPlugin());

  // Register all CRUD model routers from the single config-driven registration
  for (const route of crudRoutes) {
    builder.register(route);
  }

  const app = builder
    .register(new RecordingsPlugin())
    .register(new MovieActionsPlugin())
    .register(new SearchPlugin())
    .register(new AppleCalendarPlugin())
    .register(new AppleContactsPlugin())
    .register(new TriviaAutoSearchPlugin())
    .register(adminPlugin)
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
