import {DateTime} from "luxon";
import {AIRequest, Channel, Group, Message, ScheduledTask, TaskRunLog} from "../../models";
import {getOrchestrator} from "../../orchestrator";
import type {ScriptRunner} from "./types";

/**
 * Read-only snapshot of everything an operator wants to see at a glance:
 * - Orchestrator running state + connected channel/group counts
 * - Channel status per-channel
 * - Queue state from the GroupQueue
 * - Active scheduled tasks + next run times
 * - Very recent error counts
 *
 * Pure read. `wetRun` is ignored.
 */
export const systemStatus: ScriptRunner = async (): Promise<{
  success: boolean;
  results: string[];
}> => {
  const results: string[] = [];
  const now = DateTime.utc();
  const hourAgo = now.minus({hours: 1}).toJSDate();
  const dayAgo = now.minus({days: 1}).toJSDate();

  const orchestrator = getOrchestrator();
  if (!orchestrator) {
    results.push("Orchestrator: NOT RUNNING");
  } else {
    const connectedChannels = orchestrator.channelManager.getConnectedChannelCount();
    const groups = orchestrator.channelManager.getAllGroups();
    results.push(
      `Orchestrator: running (${connectedChannels} connected channels, ${groups.length} groups)`
    );
  }

  // Channel status from the DB (source of truth for disconnected ones)
  const channels = await Channel.find({}).sort({name: 1});
  results.push(`Channels (${channels.length}):`);
  for (const ch of channels) {
    const last = ch.lastConnectedAt
      ? DateTime.fromJSDate(ch.lastConnectedAt).toRelative()
      : "never";
    results.push(`  - ${ch.name} (${ch.type}): ${ch.status}, last connected ${last}`);
  }

  const groupCount = await Group.countDocuments({});
  results.push(`Groups in DB: ${groupCount}`);

  // Message + AI activity
  const [messagesLastHour, messagesLastDay, aiRequestsLastHour, aiRequestsLastDay] =
    await Promise.all([
      Message.countDocuments({created: {$gte: hourAgo}}),
      Message.countDocuments({created: {$gte: dayAgo}}),
      AIRequest.countDocuments({created: {$gte: hourAgo}}),
      AIRequest.countDocuments({created: {$gte: dayAgo}}),
    ]);
  results.push(`Messages: ${messagesLastHour} in last 1h, ${messagesLastDay} in last 24h`);
  results.push(`AI requests: ${aiRequestsLastHour} in last 1h, ${aiRequestsLastDay} in last 24h`);

  // AI errors (last 24h)
  const aiErrors24h = await AIRequest.countDocuments({
    created: {$gte: dayAgo},
    status: {$in: ["failed", "timeout"]},
  });
  if (aiErrors24h > 0) {
    results.push(`AI request errors (last 24h): ${aiErrors24h}`);
  }

  // Scheduled tasks
  const activeTasks = await ScheduledTask.find({status: "active"}).sort({nextRunAt: 1}).limit(10);
  results.push(`Active scheduled tasks (${activeTasks.length}):`);
  for (const task of activeTasks.slice(0, 5)) {
    const next = task.nextRunAt
      ? DateTime.fromJSDate(task.nextRunAt).toRelative({base: now})
      : "not scheduled";
    results.push(`  - ${task.name}: next run ${next}`);
  }
  if (activeTasks.length > 5) {
    results.push(`  … and ${activeTasks.length - 5} more`);
  }

  // Failing task runs
  const failedRuns24h = await TaskRunLog.countDocuments({
    startedAt: {$gte: dayAgo},
    status: {$in: ["failed", "timeout"]},
  });
  if (failedRuns24h > 0) {
    results.push(`Task runs failed/timed out (last 24h): ${failedRuns24h}`);
  }

  return {success: true, results};
};
