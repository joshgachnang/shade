import {logger} from "@terreno/api";
import type express from "express";
import {Group} from "../models/group";
import {ChannelManager} from "./channels/manager";
import {logError} from "./errors";
import {GroupQueue} from "./groupQueue";
import type {IpcCreateFeature, IpcRadioStream, IpcTriviaToggle} from "./ipc";
import {IpcWatcher} from "./ipc";
import {
  ensureGroupDirectory,
  getGroupMemoryPath,
  initGlobalMemory,
  writeMemory,
} from "./memory";
import {MessageLoop} from "./messageLoop";
import {DirectAgentRunner} from "./runners/direct";
import {OpenAIAgentRunner} from "./runners/openai";
import type {AgentRunner} from "./runners/types";
import {PrWatcher} from "./services/prWatcher";
import {RadioTranscriber} from "./services/radioTranscriber";
import {TriviaMonitor} from "./services/triviaMonitor";

const FEATURE_CHANNEL_MEMORY = (featureName: string, description?: string): string => {
  return `# Feature Channel: ${featureName}

You are driving a feature-development workflow inside a dedicated Slack
channel. Every message in this channel is routed to you automatically —
the user does **not** need to \`@Shade\`-mention you to trigger a reply,
so don't tell them they have to. This channel is split between two
runners, configured by the orchestrator based on \`Group.featurePhase\`:
${description ? `\n**Initial description:** ${description}\n` : ""}
## Runners

- **Planning** (phase \`planning\`) — OpenAI model from
  \`AppConfig.models.planner\` (default \`gpt-5.4\`). Drives the \`/ip\`
  workflow conversationally. Writes plan drafts to
  \`docs/implementationPlans/<feature>.md\` inside this group folder.
- **Implementation** (phases \`implementing\` and \`complete\`) — Claude Agent
  SDK. Executes the approved plan via the \`/implement\` skill.

The user flips from planning to implementing by typing \`/implement\` or
\`!implement\` in the channel. The orchestrator detects this and sets
\`featurePhase\` on the group before handing to Claude.

## What YOU (the agent running this turn) must do

Because this same \`CLAUDE.md\` is in the system prompt for both runners, each
runner follows the part that applies to it:

### If you are the planner (OpenAI)

- Drive \`/ip\` as a chat. One step per turn. Ask for confirmation before
  advancing.
- Never output application source code. Your job is plan prose, tables, and
  task lists.
- When you emit the final plan, wrap it in a \`\`\`markdown ... \`\`\` fenced
  block so the orchestrator can persist it.
- When the plan is done and the user is happy, tell them to type
  \`/implement\` to hand off.

### If you are the implementor (Claude Agent SDK)

- The plan already exists at
  \`docs/implementationPlans/${featureName}.md\` (written by the planner).
  Read it first.
- Run the \`/implement\` skill to execute the plan end-to-end. Mark tasks
  complete in the plan document as you go.
- Post periodic progress updates in the channel.
- All service credentials and config live in \`AppConfig\` (loaded via
  \`loadAppConfig()\`). Do not read API keys or endpoints from ad-hoc env
  vars — go through AppConfig.
- When everything is done, summarize what shipped and link the final plan.

## Hard rules (both runners)

- **Never** write implementation code during the \`planning\` phase.
- **Never** invoke \`/implement\` before the user has approved the plan.
- If the user changes scope mid-flight, re-run the affected \`/ip\` substep
  rather than patching code ad-hoc. If we're already in \`implementing\`, the
  operator can manually reset \`Group.featurePhase\` back to \`planning\`.
- Prefer small, verifiable commits.
`;
};

const FEATURE_CHANNEL_GREETING = (featureName: string, plannerModel: string): string => {
  return (
    `Feature channel ready for *${featureName}*! :sparkles:\n\n` +
    `*You don't need to \`@Shade\` me in this channel* — every message you send here goes straight to me.\n\n` +
    `Here's how we'll work in this channel:\n` +
    `1. *Planning phase* — I'll drive the \`/ip\` workflow with you using OpenAI \`${plannerModel}\` (research, shape, tasks, acceptance criteria, adversarial review). You describe the idea; I ask clarifying questions and produce a plan draft you can review.\n` +
    `2. *Handoff* — when you're happy with the plan, type \`/implement\` (or \`!implement\`). That flips this channel to implementation mode.\n` +
    `3. *Implementation phase* — the Claude Agent SDK takes over, reads the plan, and executes it end-to-end.\n\n` +
    `To kick things off: what are you trying to build, and why? A few sentences is enough — I'll shape it from there.`
  );
};

export interface OrchestratorState {
  runner: AgentRunner;
  channelManager: ChannelManager;
  groupQueue: GroupQueue;
  messageLoop: MessageLoop;
  ipcWatcher: IpcWatcher;
  radioTranscriber: RadioTranscriber;
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
  // Planner runner is used for feature-channel groups while they are in the
  // `planning` phase. It drives the /ip workflow via the OpenAI Chat
  // Completions API (model from AppConfig.models.planner, default gpt-5.4).
  const plannerRunner = new OpenAIAgentRunner();

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
      logger.info(
        `Normalized ${result.modifiedCount} feature group(s) to requiresTrigger=false`
      );
    }
  } catch (err) {
    logError("Failed to normalize feature group triggers (non-fatal)", err);
  }

  try {
    await channelManager.initialize();
  } catch (err) {
    logError("Channel manager initialization error (non-fatal)", err);
  }

  const groupQueue = new GroupQueue(runner, channelManager, plannerRunner);

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

    // Create a Group record so the orchestrator listens to this channel.
    // `featurePhase: "planning"` causes GroupQueue to route messages to the
    // OpenAI planner runner until the user types `/implement`, which flips
    // the phase to `implementing` and hands control to the Claude Agent SDK.
    const folder = `features/${data.name}`;
    const group = await Group.create({
      name: data.name,
      folder,
      channelId: sourceGroup.channelId,
      externalId: slackChannelId,
      trigger: "@Shade",
      // Feature channels are always "addressed" implicitly — every message in
      // the dedicated channel is meant for Shade, so don't require a mention.
      requiresTrigger: false,
      isMain: false,
      modelConfig: sourceGroup.modelConfig,
      executionConfig: sourceGroup.executionConfig,
      featurePhase: "planning",
    });

    // Register in the live cache so messages flow immediately
    channelManager.registerGroup(group);
    await ensureGroupDirectory(folder);

    // Pin the /ip -> /implement workflow into the feature channel's group
    // memory so every agent turn in this channel is anchored to the flow.
    try {
      await writeMemory(
        getGroupMemoryPath(folder),
        FEATURE_CHANNEL_MEMORY(data.name, data.description)
      );
    } catch (err) {
      logError(`Failed to write feature channel memory for ${data.name}`, err);
    }

    // Load AppConfig lazily so the greeting surfaces the actual planner model
    // the operator has configured (don't hardcode "gpt-5.4" here — AppConfig
    // is the single source of truth per project rules).
    const {loadAppConfig} = await import("../models/appConfig");
    const appConfig = await loadAppConfig();
    const plannerModel = appConfig.models?.planner || "gpt-5.4";

    await channelManager.sendMessage(
      sourceGroup.channelId.toString(),
      slackChannelId,
      FEATURE_CHANNEL_GREETING(data.name, plannerModel)
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

  // Start PR watcher (non-fatal if it fails)
  const prWatcher = new PrWatcher(channelManager, runner);
  try {
    await prWatcher.start();
  } catch (err) {
    logError("PR watcher start error (non-fatal)", err);
  }

  // Start trivia monitor — unified service (formerly TriviaMonitor +
  // TriviaAutoSearch). Also hooks chat-command routing for `!trivia`.
  const triviaMonitor = new TriviaMonitor(channelManager);
  messageLoop.setTriviaMonitor(triviaMonitor);
  try {
    await triviaMonitor.start();
  } catch (err) {
    logError("Trivia monitor start error (non-fatal)", err);
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
