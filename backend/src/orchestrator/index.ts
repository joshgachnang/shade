import {logger} from "@terreno/api";
import type express from "express";
import {Group} from "../models/group";
import {ChannelManager} from "./channels/manager";
import {logError} from "./errors";
import {GroupQueue} from "./groupQueue";
import type {IpcCreateFeature, IpcRadioStream, IpcTriviaToggle} from "./ipc";
import {IpcWatcher} from "./ipc";
import {ensureGroupDirectory, initGlobalMemory} from "./memory";
import {MessageLoop} from "./messageLoop";
import {DirectAgentRunner} from "./runners/direct";
import type {AgentRunner} from "./runners/types";
import {PrWatcher} from "./services/prWatcher";
import {RadioTranscriber} from "./services/radioTranscriber";
import {TriviaAutoSearch} from "./services/triviaAutoSearch";
import {TriviaMonitor} from "./services/triviaMonitor";

export interface OrchestratorState {
  runner: AgentRunner;
  channelManager: ChannelManager;
  groupQueue: GroupQueue;
  messageLoop: MessageLoop;
  ipcWatcher: IpcWatcher;
  radioTranscriber: RadioTranscriber;
  triviaAutoSearch: TriviaAutoSearch;
  prWatcher: PrWatcher;
  triviaMonitor: TriviaMonitor;
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

  logger.debug("Starting Shade orchestrator...");

  // Initialize memory system
  try {
    await initGlobalMemory();
  } catch (err) {
    logger.error(`Failed to initialize global memory (non-fatal): ${err}`);
  }

  const runner = new DirectAgentRunner();

  // Create and initialize channel manager. ChannelManager.initialize logs its
  // own channel count, so we don't need a separate "initialized" line here.
  const channelManager = new ChannelManager();
  if (expressApp) {
    channelManager.setExpressApp(expressApp);
  }

  try {
    await channelManager.initialize();
  } catch (err) {
    logError("Channel manager initialization error (non-fatal)", err);
  }

  const groupQueue = new GroupQueue(runner, channelManager);

  // Create and start message polling loop
  const messageLoop = new MessageLoop(channelManager, groupQueue);
  await messageLoop.start();

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
  ipcWatcher.setAddReaction(async (channelId, groupExternalId, messageTs, emoji) => {
    try {
      await channelManager.addReaction(channelId, groupExternalId, messageTs, emoji);
    } catch (err) {
      logger.error(
        `IPC addReaction failed (channel=${channelId}, group=${groupExternalId}, emoji=${emoji}): ${err}`
      );
    }
  });
  ipcWatcher.setCreateFeature(async (data: IpcCreateFeature) => {
    // Find the source group to get the channelId (MongoDB ObjectId)
    const sourceGroup = await Group.findById(data.groupId);
    if (!sourceGroup) {
      throw new Error(`Source group ${data.groupId} not found`);
    }

    // Create the Slack channel and invite the user
    const {slackChannelId} = await channelManager.createFeatureChannel(
      sourceGroup.channelId.toString(),
      data.name,
      data.senderExternalId
    );

    // Create a Group record so the orchestrator listens to this channel
    const folder = `features/${data.name}`;
    const group = await Group.create({
      name: data.name,
      folder,
      channelId: sourceGroup.channelId,
      externalId: slackChannelId,
      trigger: "@Shade",
      requiresTrigger: false,
      isMain: false,
      modelConfig: sourceGroup.modelConfig,
      executionConfig: sourceGroup.executionConfig,
    });

    // Register in the live cache so messages flow immediately
    channelManager.registerGroup(group);
    await ensureGroupDirectory(folder);

    // Send the initial prompt to the new channel
    await channelManager.sendMessage(
      sourceGroup.channelId.toString(),
      slackChannelId,
      `Feature channel ready! What's the idea for *${data.name}*? Describe what you're thinking and I'll help shape it.`
    );

    logger.info(`Feature channel created: #${data.name} (${slackChannelId}), group ${group._id}`);
  });

  // Start radio transcriber (non-fatal if it fails)
  const radioTranscriber = new RadioTranscriber(channelManager);
  try {
    await radioTranscriber.start();
  } catch (err) {
    logError("Radio transcriber start error (non-fatal)", err);
  }

  // Start trivia auto-search (non-fatal if it fails)
  const triviaAutoSearch = new TriviaAutoSearch(channelManager);
  messageLoop.setTriviaAutoSearch(triviaAutoSearch);
  try {
    await triviaAutoSearch.start();
  } catch (err) {
    logError("Trivia auto-search start error (non-fatal)", err);
  }

  // Start PR watcher (non-fatal if it fails)
  const prWatcher = new PrWatcher(channelManager, runner);
  try {
    await prWatcher.start();
  } catch (err) {
    logError("PR watcher start error (non-fatal)", err);
  }

  // Start trivia monitor (non-fatal if it fails)
  const triviaMonitor = new TriviaMonitor(channelManager);
  try {
    await triviaMonitor.start();
  } catch (err) {
    logError("Trivia monitor start error (non-fatal)", err);
  }

  ipcWatcher.setTriviaToggle(async (data: IpcTriviaToggle) => {
    const {AppConfig, reloadAppConfig} = await import("../models/appConfig");
    await AppConfig.findOneAndUpdate({}, {$set: {"triviaAutoSearch.enabled": data.enabled}});
    await reloadAppConfig();

    if (data.enabled) {
      await triviaAutoSearch.start();
    } else {
      triviaAutoSearch.stop();
    }
  });

  ipcWatcher.setRadioStream(async (data: IpcRadioStream) => {
    const {RadioStream} = await import("../models/radioStream");
    const doc = await RadioStream.findById(data.radioStreamId);
    if (!doc) {
      throw new Error(`RadioStream ${data.radioStreamId} not found`);
    }

    if (data.type === "start_radio_stream") {
      await RadioStream.findByIdAndUpdate(doc._id, {
        $set: {status: "active", errorMessage: undefined, reconnectCount: 0},
      });
      const updated = await RadioStream.findById(doc._id);
      if (updated) {
        await radioTranscriber.startStream(updated);
      }
    } else {
      await radioTranscriber.stopStream(data.radioStreamId);
      await RadioStream.findByIdAndUpdate(doc._id, {$set: {status: "stopped"}});
    }
  });
  await ipcWatcher.start();

  state = {
    runner,
    channelManager,
    groupQueue,
    messageLoop,
    ipcWatcher,
    radioTranscriber,
    triviaAutoSearch,
    prWatcher,
    triviaMonitor,
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
  state.triviaAutoSearch.stop();
  state.prWatcher.stop();
  state.triviaMonitor.stop();

  try {
    await state.radioTranscriber.stop();
  } catch (err) {
    logger.error(`Error stopping radio transcriber: ${err}`);
  }

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
