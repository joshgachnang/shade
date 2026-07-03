import {loadAppConfig} from "./models/appConfig";
import type {AppConfigDocument} from "./types";
import {hydrateEnvFromConfig} from "./utils/configEnv";
import {connectToMongoDB} from "./utils/database";
import {initDirectories} from "./utils/directories";

/**
 * Shared boot sequence for every Shade process — the gateway (`server.ts`)
 * and the task worker (`workerMain.ts`) call this identically before starting
 * their own services:
 *
 *   1. Connect to Mongo (needs MONGO_URI env — cannot live in AppConfig).
 *   2. Load AppConfig and hydrate `process.env` from it, so anything that
 *      reads env below (TerrenoApp JWT setup, filesystem paths, public URL)
 *      sees values sourced from AppConfig as fallbacks.
 *   3. Init filesystem dirs (uses hydrated SHADE_DATA_DIR via config.ts).
 *
 * Returns the loaded AppConfig so callers don't have to re-fetch it.
 */
export const boot = async (): Promise<AppConfigDocument> => {
  await connectToMongoDB();
  const appConfig = await loadAppConfig();
  hydrateEnvFromConfig(appConfig);
  await initDirectories();
  return appConfig;
};
