import {logger} from "@terreno/api";
import {EdgeAgent} from "../models/edgeAgent";
import {EdgeAgentEvent} from "../models/edgeAgentEvent";

const OFFLINE_THRESHOLD_MS = 90_000; // 90 seconds
const ERROR_THRESHOLD_MS = 300_000; // 5 minutes
const CHECK_INTERVAL_MS = 60_000; // 1 minute

let intervalHandle: ReturnType<typeof setInterval> | null = null;

const checkAgentHealth = async (): Promise<void> => {
  const now = new Date();
  const offlineThreshold = new Date(now.getTime() - OFFLINE_THRESHOLD_MS);
  const errorThreshold = new Date(now.getTime() - ERROR_THRESHOLD_MS);

  // Mark online agents as offline if no heartbeat in 90s
  const staleOnline = await EdgeAgent.findOneAndUpdate(
    {
      status: "online",
      lastHeartbeatAt: {$lt: offlineThreshold},
    },
    {$set: {status: "offline"}},
    {new: false}
  );

  if (staleOnline) {
    logger.info(`Edge agent "${staleOnline.name}" marked offline (no heartbeat)`);
    await EdgeAgentEvent.create({
      agentId: staleOnline._id,
      eventType: "status_changed",
      payload: {from: "online", to: "offline", reason: "heartbeat_timeout"},
    });
    // Check for more
    await checkAgentHealth();
    return;
  }

  // Mark offline agents as error if no heartbeat in 300s
  const staleOffline = await EdgeAgent.findOneAndUpdate(
    {
      status: "offline",
      lastHeartbeatAt: {$lt: errorThreshold},
    },
    {$set: {status: "error"}},
    {new: false}
  );

  if (staleOffline) {
    logger.info(`Edge agent "${staleOffline.name}" marked error (extended heartbeat timeout)`);
    await EdgeAgentEvent.create({
      agentId: staleOffline._id,
      eventType: "status_changed",
      payload: {from: "offline", to: "error", reason: "extended_heartbeat_timeout"},
    });
    // Check for more
    await checkAgentHealth();
  }
};

export const startHealthMonitor = (): void => {
  logger.info("Starting edge agent health monitor");
  intervalHandle = setInterval(() => {
    checkAgentHealth().catch((err) => {
      logger.error(`Edge agent health check failed: ${err}`);
    });
  }, CHECK_INTERVAL_MS);
};

export const stopHealthMonitor = (): void => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};
