import {randomBytes} from "node:crypto";
import {AppConfig, loadAppConfig} from "../../models/appConfig";
import type {ScriptRunner} from "./types";

/**
 * Generates new JWT access + refresh secrets and writes them to AppConfig.
 *
 * Requires a Shade restart to take effect — the warn-on-change hook in
 * AppConfig's post-save will note this in the logs. All existing JWT sessions
 * will be invalidated once the new secrets are live.
 *
 * Dry-run prints what would change; wet-run persists.
 */
export const rotateJwtSecrets: ScriptRunner = async (
  wetRun: boolean
): Promise<{success: boolean; results: string[]}> => {
  const results: string[] = [];

  const newTokenSecret = randomBytes(32).toString("hex");
  const newRefreshTokenSecret = randomBytes(32).toString("hex");

  const config = await loadAppConfig();
  const hadToken = config.auth?.tokenSecret && config.auth.tokenSecret.length > 0;
  const hadRefresh = config.auth?.refreshTokenSecret && config.auth.refreshTokenSecret.length > 0;

  results.push("Generated two new 256-bit secrets.");
  results.push(`  - auth.tokenSecret:        ${hadToken ? "rotating existing" : "setting fresh"}`);
  results.push(
    `  - auth.refreshTokenSecret: ${hadRefresh ? "rotating existing" : "setting fresh"}`
  );

  if (!wetRun) {
    results.push("");
    results.push("Dry run — nothing written. Re-run with wet-run to apply.");
    return {success: true, results};
  }

  await AppConfig.updateOne(
    {_id: config._id},
    {
      $set: {
        "auth.tokenSecret": newTokenSecret,
        "auth.refreshTokenSecret": newRefreshTokenSecret,
      },
    }
  );

  results.push("");
  results.push("Secrets written to AppConfig.");
  results.push(
    "RESTART Shade for the new secrets to take effect — existing JWT sessions will stop working once the new secrets are live."
  );

  return {success: true, results};
};
