import os from "node:os";
import type {
  CommandResult,
  HeartbeatRequest,
  HeartbeatResponse,
} from "@shade/edge-agent-types";
import type {AgentState} from "./state";

export interface HeartbeatCommand {
  commandId: string;
  type: string;
  payload: Record<string, unknown>;
}

export type CommandHandler = (command: HeartbeatCommand) => Promise<CommandResult>;

export interface HeartbeatLoopOptions {
  state: AgentState;
  intervalMs: number;
  version: string;
  onCommand: CommandHandler;
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let pendingResults: CommandResult[] = [];
let backoffMs = 0;
const MAX_BACKOFF_MS = 60_000;
const startTime = Date.now();

const sendHeartbeat = async (options: HeartbeatLoopOptions): Promise<void> => {
  const body: HeartbeatRequest = {
    status: "healthy",
    platform: os.platform(),
    arch: os.arch(),
    version: options.version,
    hostname: os.hostname(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    memoryUsage: process.memoryUsage().rss,
    commandResults: pendingResults,
  };

  // Clear pending results before sending (will re-add on failure)
  const sentResults = [...pendingResults];
  pendingResults = [];

  try {
    const response = await fetch(`${options.state.shadeUrl}/api/edge/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Token": options.state.token,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Heartbeat failed (${response.status})`);
    }

    const data = (await response.json()) as HeartbeatResponse;
    backoffMs = 0;

    // Process commands
    for (const cmd of data.commands) {
      try {
        const result = await options.onCommand(cmd);
        pendingResults.push(result);
      } catch (err) {
        pendingResults.push({
          commandId: cmd.commandId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          completedAt: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    // Re-queue unsent results
    pendingResults.push(...sentResults);
    backoffMs = Math.min(backoffMs === 0 ? 1000 : backoffMs * 2, MAX_BACKOFF_MS);
    console.error(`Heartbeat failed, retry in ${backoffMs}ms: ${err}`);
  }
};

export const startHeartbeatLoop = (options: HeartbeatLoopOptions): void => {
  stopHeartbeatLoop();

  // Send immediately
  sendHeartbeat(options).catch((err) => {
    console.error(`Initial heartbeat failed: ${err}`);
  });

  heartbeatTimer = setInterval(() => {
    const delay = backoffMs > 0 ? backoffMs : 0;
    if (delay > 0) {
      return; // Skip this tick, wait for backoff
    }
    sendHeartbeat(options).catch((err) => {
      console.error(`Heartbeat error: ${err}`);
    });
  }, options.intervalMs);
};

export const stopHeartbeatLoop = (): void => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
};

export const addCommandResult = (result: CommandResult): void => {
  pendingResults.push(result);
};
