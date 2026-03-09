import {logger} from "@terreno/api";
import type express from "express";
import {ChannelManager} from "./channels/manager";
import {GroupQueue} from "./groupQueue";
import {IpcWatcher} from "./ipc";
import {initGlobalMemory} from "./memory";
import {MessageLoop} from "./messageLoop";
import {DirectAgentRunner} from "./runners/direct";
import type {AgentRunner} from "./runners/types";

export interface OrchestratorState {
  runner: AgentRunner;
  channelManager: ChannelManager;
  groupQueue: GroupQueue;
  messageLoop: MessageLoop;
  ipcWatcher: IpcWatcher;
  isRunning: boolean;
}

let state: OrchestratorState | null = null;

export const getOrchestrator = (): OrchestratorState | null => state;

export const startOrchestrator = async (
  expressApp?: express.Application
): Promise<OrchestratorState> => {
  if (state?.isRunning) {
    logger.warn("Orchestrator already running");
    return state;
  }

  logger.info("Starting Shade orchestrator...");

  // Initialize memory system
  try {
    await initGlobalMemory();
    logger.info("Global memory initialized");
  } catch (err) {
    logger.error(`Failed to initialize global memory (non-fatal): ${err}`);
  }

  // Create the agent runner
  const runner = new DirectAgentRunner();
  logger.info("Agent runner created");

  // Create and initialize channel manager
  const channelManager = new ChannelManager();
  if (expressApp) {
    channelManager.setExpressApp(expressApp);
  }

  try {
    await channelManager.initialize();
    logger.info("Channel manager initialized");
  } catch (err) {
    logger.error(`Channel manager initialization error (non-fatal): ${err}`);
    if (err instanceof Error) {
      logger.error(err.stack ?? "no stack trace");
    }
  }

  // Create group queue wired to the agent runner
  const groupQueue = new GroupQueue(runner, channelManager);
  logger.info("Group queue created");

  // Create and start message polling loop
  const messageLoop = new MessageLoop(channelManager, groupQueue);
  messageLoop.start();

  // Create and start IPC watcher with send message handler
  const ipcWatcher = new IpcWatcher();
  ipcWatcher.setSendMessage(async (channelId, targetGroupExternalId, content) => {
    try {
      await channelManager.sendMessage(channelId, targetGroupExternalId, content);
    } catch (err) {
      logger.error(
        `IPC sendMessage failed (channel=${channelId}, group=${targetGroupExternalId}): ${err}`
      );
    }
  });
  ipcWatcher.start();

  state = {
    runner,
    channelManager,
    groupQueue,
    messageLoop,
    ipcWatcher,
    isRunning: true,
  };

  const channelCount = channelManager.getConnectedChannelCount();
  const groupCount = channelManager.getAllGroups().length;
  logger.info(`Shade orchestrator started (${channelCount} channels, ${groupCount} groups)`);

  return state;
};

export const stopOrchestrator = async (): Promise<void> => {
  if (!state) {
    return;
  }

  logger.info("Stopping Shade orchestrator...");

  state.messageLoop.stop();
  state.ipcWatcher.stop();

  try {
    await state.channelManager.disconnectAll();
  } catch (err) {
    logger.error(`Error during channel disconnect: ${err}`);
  }

  state.isRunning = false;
  state = null;

  logger.info("Shade orchestrator stopped");
};

// Graceful shutdown
const handleShutdown = async (signal: string): Promise<void> => {
  logger.info(`Received ${signal}, shutting down orchestrator...`);
  try {
    await stopOrchestrator();
  } catch (err) {
    logger.error(`Error during shutdown: ${err}`);
  }
  process.exit(0);
};

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));
