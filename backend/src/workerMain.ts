/**
 * Shade task worker entrypoint (IP-010 gateway/worker split).
 *
 * Runs the shared boot sequence (`boot.ts`) and then starts ONLY:
 *   - a TaskWorkerService claiming AgentTask board work from Mongo, and
 *   - a tiny Bun.serve /health app on WORKER_PORT (default 4021).
 *
 * No channels, MessageLoop, IpcWatcher, scheduler, or HTTP API — those stay
 * in the gateway (`server.ts`). Coordination is Mongo (the task board) plus
 * IPC files: agents run by this process, and this process's own result
 * delivery, write files into `paths.ipc` that the gateway's IpcWatcher
 * relays to channels.
 *
 * Usage: `bun run worker` (from backend/), or the shade-worker systemd unit.
 */
import {logger} from "@terreno/api";
import {boot} from "./boot";
import {loadAppConfig} from "./models/appConfig";
import type {ChannelManager} from "./orchestrator/channels/manager";
import {logError} from "./orchestrator/errors";
import {DirectAgentRunner} from "./orchestrator/runners/direct";
import {MockAgentRunner} from "./orchestrator/runners/mock";
import type {AgentRunner} from "./orchestrator/runners/types";
import {getWorkerId} from "./orchestrator/services/taskBoard";
import {TaskWorkerService} from "./orchestrator/services/taskWorker";
import {isTestMode} from "./testMode/flag";
import {drainAndStop, IpcResultDeliverer} from "./workerRuntime";

const DEFAULT_WORKER_PORT = 4021;
const DEFAULT_POLL_MS = 5000;
const DEFAULT_DRAIN_TIMEOUT_MS = 900000;

// Global error handlers — prevent uncaught errors from crashing the process
// (parity with server.ts, minus Sentry which is only preloaded for the API).
process.on("uncaughtException", (error) => {
  logError("Uncaught exception (worker will continue)", error);
});

process.on("unhandledRejection", (reason, _promise) => {
  logError("Unhandled promise rejection (worker)", reason);
});

export const startWorker = async (): Promise<void> => {
  logger.info("Shade worker starting up...");

  const appConfig = await boot();

  const workerId = getWorkerId();
  const startedAtMs = Date.now();

  // Test mode (IP-012): board tasks run through the deterministic mock.
  const runner: AgentRunner = isTestMode() ? new MockAgentRunner() : new DirectAgentRunner();
  // Workers never connect channel connectors (the gateway owns the Slack
  // socket), so result delivery goes through send_message IPC files instead
  // of a live ChannelManager. IpcResultDeliverer implements the single
  // ChannelManager method TaskWorkerService calls (sendMessageToGroup); the
  // cast documents that contract without changing TaskWorkerService.
  const deliverer = new IpcResultDeliverer();
  const worker = new TaskWorkerService({
    runner,
    channelManager: deliverer as unknown as ChannelManager,
  });

  // The claim loop is owned here rather than via TaskWorkerService.start()
  // so shutdown can stop claiming *without* aborting in-flight runs —
  // TaskWorkerService.stop() does both at once, which would defeat the drain.
  let claimIntervalId: ReturnType<typeof setInterval> | null = null;
  let lastTick: Promise<void> = Promise.resolve();

  if (appConfig.taskWorker?.enabled === false) {
    logger.warn("Task worker disabled (AppConfig.taskWorker.enabled=false) — worker will idle");
  } else {
    const pollMs = appConfig.taskWorker?.pollMs ?? DEFAULT_POLL_MS;
    // Immediate first tick so tasks already pending on boot don't wait a full interval.
    lastTick = worker.tick().catch((err) => logError("Worker initial tick error", err));
    claimIntervalId = setInterval(() => {
      lastTick = worker.tick().catch((err) => logError("Worker tick error", err));
    }, pollMs);
    logger.info(`Worker claim loop started (worker ${workerId}, interval: ${pollMs}ms)`);
  }

  const port = Number(process.env.WORKER_PORT) || DEFAULT_WORKER_PORT;
  const healthServer = Bun.serve({
    port,
    fetch(req: Request): Response {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return Response.json({
          status: "ok",
          workerId,
          runningTasks: worker.activeCount,
          uptimeSeconds: Math.floor((Date.now() - startedAtMs) / 1000),
        });
      }
      return new Response("Not found", {status: 404});
    },
  });
  logger.info(`Worker health endpoint on http://localhost:${healthServer.port}/health`);

  // Graceful shutdown: stop claiming, drain in-flight runs up to
  // taskWorker.taskTimeoutMs, abort whatever remains (stale-heartbeat reclaim
  // retries those tasks), then exit 0.
  let shuttingDown = false;
  const handleShutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info(`Received ${signal} — stopping claim loop (no new claims)`);
    if (claimIntervalId) {
      clearInterval(claimIntervalId);
      claimIntervalId = null;
    }
    // Let an in-flight tick finish so its claims are registered before draining.
    await lastTick;

    try {
      // Re-load config so a runtime-edited drain bound takes effect.
      const freshConfig = await loadAppConfig();
      const drainTimeoutMs = freshConfig.taskWorker?.taskTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
      await drainAndStop(worker, drainTimeoutMs);
    } catch (err) {
      logError("Error during worker drain (aborting remaining runs)", err);
      worker.stop();
    }

    healthServer.stop(true);
    logger.info("Shade worker shut down cleanly");
    process.exit(0);
  };

  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("SIGINT", () => handleShutdown("SIGINT"));

  logger.info(`Shade worker started (worker ${workerId})`);
};

if (process.env.NODE_ENV !== "test") {
  startWorker().catch((error) => {
    logError("Fatal error starting worker", error);
    process.exit(1);
  });
}
