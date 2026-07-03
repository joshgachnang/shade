import {reloadAppConfig} from "../../models/appConfig";
import type {ScriptRunner} from "./types";

/**
 * Clears the in-memory AppConfig cache and re-fetches from Mongo. Useful if
 * someone edits the document directly via the Mongo shell (bypassing the
 * post-save hooks) — without this, `loadAppConfig()` keeps returning the
 * stale cached doc.
 *
 * Note this does NOT re-hydrate `process.env` (that only happens at boot).
 * Fields consumed at startup (JWT secrets, log level, etc.) still need a
 * Shade restart to take effect. See `utils/configEnv.ts`.
 *
 * `wetRun` ignored — the action is cheap and always safe.
 */
export const reloadAppConfigCache: ScriptRunner = async (): Promise<{
  success: boolean;
  results: string[];
}> => {
  const results: string[] = [];
  const doc = await reloadAppConfig();
  results.push(`AppConfig cache reloaded. Document _id: ${doc._id}`);
  results.push(
    "Note: env vars hydrated at boot are NOT refreshed. Restart Shade if you changed a hydrated field."
  );
  return {success: true, results};
};
