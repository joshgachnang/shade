import {logger} from "@terreno/api";
import type express from "express";
import {loadAppConfig} from "../models/appConfig";
import {Group} from "../models/group";
import {isTestMode} from "../testMode/flag";
import {shouldRunTaskWorkerInGateway} from "../workerRuntime";
import {ensureBuiltinScheduledTasks, seedBuiltinSkills} from "./builtinSkills";
import {ChannelManager} from "./channels/manager";
import {createFeatureHandler} from "./createFeature";
import {logError} from "./errors";
import {GroupQueue} from "./groupQueue";
import type {IpcRadioStream, IpcTriviaToggle} from "./ipc";
import {IpcWatcher} from "./ipc";
import {initGlobalMemory} from "./memory";
import {MessageLoop} from "./messageLoop";
import {DirectAgentRunner} from "./runners/direct";
import {MockAgentRunner} from "./runners/mock";
import {OpenAIAgentRunner} from "./runners/openai";
import type {AgentRunner} from "./runners/types";
import {ZergAgentRunner} from "./runners/zerg";
import {BreweryPoller} from "./services/breweryPoller";
import {InfraWatcher} from "./services/infraWatcher";
import {PrWatcher} from "./services/prWatcher";
import {RadioTranscriber} from "./services/radioTranscriber";
import {registerSchedulerForWake, SchedulerService} from "./services/scheduler";
import {TaskWorkerService} from "./services/taskWorker";
import {TriviaMonitor} from "./services/triviaMonitor";

export interface OrchestratorState {
  runner: AgentRunner;
  channelManager: ChannelManager;
  groupQueue: GroupQueue;
  messageLoop: MessageLoop;
  ipcWatcher: IpcWatcher;
  radioTranscriber: RadioTranscriber;
  prWatcher: PrWatcher;
  infraWatcher: InfraWatcher;
  triviaMonitor: TriviaMonitor;
  scheduler: SchedulerService;
  taskWorker: TaskWorkerService;
  breweryPoller: BreweryPoller;
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

  // Seed builtin skills (daily-triage, session-review) and reconcile their
  // scheduled-task loops with AppConfig.builtinTasks. Both are idempotent:
  // existing skill files are never overwritten, and tasks are upserted/paused
  // to match config.
  try {
    await seedBuiltinSkills();
  } catch (err) {
    logger.error(`Failed to seed builtin skills (non-fatal): ${err}`);
  }
  try {
    await ensureBuiltinScheduledTasks();
  } catch (err) {
    logError("Failed to ensure builtin scheduled tasks (non-fatal)", err);
  }

  // Test mode (IP-012): every agent turn runs through the deterministic mock —
  // no Anthropic/OpenAI calls. The single runner instance is shared with
  // GroupQueue, PrWatcher, and TaskWorkerService below, so one swap covers
  // every consumer; the mock also stands in for the OpenAI planner.
  const runner: AgentRunner = isTestMode() ? new MockAgentRunner() : new DirectAgentRunner();
  // Container-mode groups (executionConfig.mode === "container") run inside a
  // zerg session. In test mode the mock stands in for it too.
  const containerRunner: AgentRunner = isTestMode() ? runner : new ZergAgentRunner();
  // Planner runner is used for feature-channel groups while they are in the
  // `planning` phase. It drives the /ip workflow via the OpenAI Chat
  // Completions API (model from AppConfig.models.planner, default gpt-5.4).
  const plannerRunner: AgentRunner = isTestMode() ? runner : new OpenAIAgentRunner();

  // Create and initialize channel manager. ChannelManager.initialize logs its
  // own channel count, so we don't need a separate "initialized" line here.
  const channelManager = new ChannelManager();
  if (expressApp) {
    channelManager.setExpressApp(expressApp);
  }

  // Feature channels must auto-trigger on every message — the whole point is
  // a focused channel where the user doesn't have to @Shade me on every reply.
  // Normalize any pre-existing feature group whose `requiresTrigger` drifted
  // to true before this was enforced (or before feature channels existed at
  // all). We key off `featurePhase` since that's what marks a feature group.
  try {
    const result = await Group.updateMany(
      {featurePhase: {$exists: true}, requiresTrigger: true},
      {$set: {requiresTrigger: false}}
    );
    if (result.modifiedCount > 0) {
      logger.info(`Normalized ${result.modifiedCount} feature group(s) to requiresTrigger=false`);
    }
  } catch (err) {
    logError("Failed to normalize feature group triggers (non-fatal)", err);
  }

  try {
    await channelManager.initialize();
  } catch (err) {
    logError("Channel manager initialization error (non-fatal)", err);
  }

  const groupQueue = new GroupQueue(runner, channelManager, plannerRunner, containerRunner);

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
  ipcWatcher.setSendRichMessage(async (groupId, payload, opts) => {
    try {
      await channelManager.sendRichMessageToGroup(groupId, payload, opts);
    } catch (err) {
      logger.error(`IPC sendRichMessage failed (group=${groupId}): ${err}`);
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
  ipcWatcher.setCreateFeature(createFeatureHandler(channelManager));

  // Radio transcriber, PR watcher, and trivia monitor talk to external
  // services (radio streams/Deepgram, GitHub/Anthropic, Anthropic/webhooks) —
  // test mode constructs them for a uniform OrchestratorState but never
  // starts them.
  const radioTranscriber = new RadioTranscriber(channelManager);
  const prWatcher = new PrWatcher(channelManager, runner);
  const infraWatcher = new InfraWatcher(channelManager);
  const triviaMonitor = new TriviaMonitor(channelManager);
  messageLoop.setTriviaMonitor(triviaMonitor);

  if (isTestMode()) {
    logger.info(
      "Test mode: radio transcriber, PR watcher, infra watcher, and trivia monitor not started"
    );
  } else {
    try {
      await radioTranscriber.start();
    } catch (err) {
      logError("Radio transcriber start error (non-fatal)", err);
    }

    try {
      await prWatcher.start();
    } catch (err) {
      logError("PR watcher start error (non-fatal)", err);
    }

    try {
      await infraWatcher.start();
    } catch (err) {
      logError("Infra watcher start error (non-fatal)", err);
    }

    try {
      await triviaMonitor.start();
    } catch (err) {
      logError("Trivia monitor start error (non-fatal)", err);
    }
  }

  // Start scheduler (non-fatal if it fails) — dispatches due ScheduledTasks.
  // Registering it for wake lets task-mutating IPC handlers (schedule_task /
  // resume_task et al.) short-circuit the adaptive sleep immediately.
  const scheduler = new SchedulerService(groupQueue);
  registerSchedulerForWake(scheduler);
  try {
    await scheduler.start();
  } catch (err) {
    logError("Scheduler start error (non-fatal)", err);
  }

  // Start task worker (non-fatal if it fails) — claims and runs AgentTask
  // board work. start() itself no-ops when AppConfig.taskWorker.enabled=false.
  // With taskWorker.runInGateway=false (IP-010), board work is left to
  // dedicated worker processes (`bun run worker`); the service is still
  // constructed so OrchestratorState/stopOrchestrator stay uniform.
  const breweryPoller = new BreweryPoller();
  const taskWorker = new TaskWorkerService({runner, channelManager, containerRunner});
  const appConfig = await loadAppConfig();
  if (shouldRunTaskWorkerInGateway(appConfig)) {
    try {
      await taskWorker.start();
      await breweryPoller.start();
    } catch (err) {
      logError("Task worker start error (non-fatal)", err);
    }
  } else {
    logger.info("Task worker not started in gateway (AppConfig.taskWorker.runInGateway=false)");
  }

  ipcWatcher.setTriviaToggle(async (data: IpcTriviaToggle) => {
    const {AppConfig, reloadAppConfig} = await import("../models/appConfig");
    await AppConfig.findOneAndUpdate({}, {$set: {"triviaMonitor.enabled": data.enabled}});
    await reloadAppConfig();

    if (data.enabled) {
      await triviaMonitor.start();
    } else {
      triviaMonitor.stop();
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
    prWatcher,
    infraWatcher,
    triviaMonitor,
    scheduler,
    taskWorker,
    breweryPoller,
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
  state.prWatcher.stop();
  state.infraWatcher.stop();
  state.triviaMonitor.stop();
  registerSchedulerForWake(null);
  state.scheduler.stop();
  state.taskWorker.stop();
  await state.breweryPoller.stop();

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
