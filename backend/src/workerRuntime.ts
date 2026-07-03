import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {logger} from "@terreno/api";
import {paths} from "./config";
import {Group} from "./models/group";
import type {IpcMessage} from "./orchestrator/ipc";

/**
 * Runtime helpers for the IP-010 gateway/worker split. Everything here is
 * shared between the worker entrypoint (`workerMain.ts`) and the gateway's
 * orchestrator, and is kept free of process-level side effects so it can be
 * unit tested directly.
 */

/**
 * Whether the gateway process should run its in-process TaskWorkerService.
 * Defaults to true (missing/undefined config) — set
 * `AppConfig.taskWorker.runInGateway=false` once dedicated worker processes
 * (`bun run worker`) are deployed so board work becomes worker-only.
 */
export const shouldRunTaskWorkerInGateway = (appConfig: {
  taskWorker?: {runInGateway?: boolean} | null;
}): boolean => {
  return appConfig.taskWorker?.runInGateway !== false;
};

/**
 * Atomically write an IPC file into the given directory (tmp write + rename,
 * mirroring agentRunner/mcpServer.ts) so the gateway's IpcWatcher never reads
 * a partial file. Returns the file id.
 */
const writeIpcFile = async (ipcDir: string, data: IpcMessage): Promise<string> => {
  await fs.mkdir(ipcDir, {recursive: true});

  const fileId = randomUUID();
  const tmpPath = path.join(ipcDir, `${fileId}.tmp`);
  const finalPath = path.join(ipcDir, `${fileId}.json`);

  await fs.writeFile(tmpPath, JSON.stringify(data), "utf-8");
  await fs.rename(tmpPath, finalPath);

  return fileId;
};

/**
 * Worker-side result delivery for board tasks.
 *
 * TaskWorkerService delivers `deliverResult` task output through
 * `channelManager.sendMessageToGroup(groupId, content)`, but worker processes
 * never connect channel connectors — the gateway owns the Slack socket, and a
 * disconnected ChannelManager would silently drop sends. Instead the worker
 * writes a `send_message` IPC file (the exact JSON shape the MCP send_message
 * tool writes — see `orchestrator/ipc.ts` IpcMessage) into `paths.ipc`, where
 * the gateway's IpcWatcher picks it up and relays it to the channel. Files
 * queue on disk, so results survive a gateway restart and deliver once the
 * watcher resumes.
 *
 * This class implements only the `sendMessageToGroup` slice of ChannelManager
 * that TaskWorkerService actually calls; `workerMain.ts` casts it into the
 * dependency slot so TaskWorkerService stays unchanged.
 */
export class IpcResultDeliverer {
  async sendMessageToGroup(groupId: string, content: string): Promise<void> {
    const group = await Group.findOneOrNone({_id: groupId});
    if (!group) {
      logger.error(`IPC result delivery failed: group ${groupId} not found`);
      return;
    }

    const message: IpcMessage = {
      type: "send_message",
      groupId,
      channelId: group.channelId.toString(),
      content,
    };
    const fileId = await writeIpcFile(paths.ipc, message);
    logger.info(`Queued IPC result delivery for group ${groupId} (${fileId}.json)`);
  }
}

/** The slice of TaskWorkerService that the drain sequence depends on. */
export interface DrainableWorker {
  readonly activeCount: number;
  waitForActiveRuns: () => Promise<void>;
  stop: () => void;
}

/**
 * Graceful-drain step of worker shutdown. The caller must have already
 * stopped the claim loop (no new claims) before calling this. Waits up to
 * `timeoutMs` for in-flight task runs to settle, then calls `stop()` — which
 * aborts any runs that outlived the drain window; their stale heartbeats let
 * the next worker reclaim and retry them (IP-009 semantics).
 *
 * Returns true when all runs settled within the window, false on timeout.
 */
export const drainAndStop = async (
  service: DrainableWorker,
  timeoutMs: number
): Promise<boolean> => {
  logger.info(
    `Worker draining: waiting up to ${timeoutMs}ms for ${service.activeCount} active run(s)`
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    service.waitForActiveRuns().then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    }),
  ]);
  clearTimeout(timer);

  if (timedOut) {
    logger.warn(
      `Worker drain timed out after ${timeoutMs}ms with ${service.activeCount} run(s) still active — aborting them`
    );
  } else {
    logger.info("Worker drain complete: all active runs settled");
  }

  // Aborted runs are reclaimed via IP-009's stale-heartbeat sweep.
  service.stop();
  return !timedOut;
};
