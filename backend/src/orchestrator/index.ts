import {logger} from "@terreno/api";
import {IpcWatcher} from "./ipc";
import {initGlobalMemory} from "./memory";
import {DirectAgentRunner} from "./runners/direct";
import type {AgentRunner} from "./runners/types";

export interface OrchestratorState {
  runner: AgentRunner;
  ipcWatcher: IpcWatcher;
  isRunning: boolean;
}

let state: OrchestratorState | null = null;

export const getOrchestrator = (): OrchestratorState | null => state;

export const startOrchestrator = async (): Promise<OrchestratorState> => {
  if (state?.isRunning) {
    logger.warn("Orchestrator already running");
    return state;
  }

  logger.info("Starting Shade orchestrator...");

  // Initialize memory system
  await initGlobalMemory();

  // Create the agent runner
  const runner = new DirectAgentRunner();

  // Create and start IPC watcher
  const ipcWatcher = new IpcWatcher();
  ipcWatcher.start();

  state = {
    runner,
    ipcWatcher,
    isRunning: true,
  };

  logger.info("Shade orchestrator started");
  return state;
};

export const stopOrchestrator = async (): Promise<void> => {
  if (!state) {
    return;
  }

  logger.info("Stopping Shade orchestrator...");

  state.ipcWatcher.stop();
  state.isRunning = false;
  state = null;

  logger.info("Shade orchestrator stopped");
};

// Graceful shutdown
const handleShutdown = async (signal: string): Promise<void> => {
  logger.info(`Received ${signal}, shutting down orchestrator...`);
  await stopOrchestrator();
  process.exit(0);
};

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));
