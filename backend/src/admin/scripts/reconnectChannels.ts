import {getOrchestrator} from "../../orchestrator";
import type {ScriptRunner} from "./types";

/**
 * Disconnects every live channel connector and re-runs
 * `ChannelManager.initialize()` to reconnect from the DB list.
 *
 * Use when a channel is stuck in "connected" state but not actually receiving
 * messages, or after editing a channel's config blob in the admin UI.
 *
 * Dry-run just reports what would happen; wet-run performs the cycle.
 */
export const reconnectChannels: ScriptRunner = async (
  wetRun: boolean
): Promise<{success: boolean; results: string[]}> => {
  const results: string[] = [];
  const orchestrator = getOrchestrator();

  if (!orchestrator) {
    results.push("Orchestrator is not running; nothing to reconnect.");
    return {success: false, results};
  }

  const {channelManager} = orchestrator;
  const beforeCount = channelManager.getConnectedChannelCount();
  results.push(`Currently connected channels: ${beforeCount}`);

  if (!wetRun) {
    results.push("Dry run — would disconnect all and re-initialize.");
    return {success: true, results};
  }

  results.push("Disconnecting all channels…");
  await channelManager.disconnectAll();

  results.push("Re-initializing…");
  await channelManager.initialize();

  const afterCount = channelManager.getConnectedChannelCount();
  results.push(`Reconnect complete. Connected channels: ${afterCount}`);

  return {success: afterCount > 0 || beforeCount === 0, results};
};
