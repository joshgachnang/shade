import {logger} from "@terreno/api";
import type express from "express";
import {loadAppConfig} from "../models/appConfig";
import {Feature} from "../models/feature";
import {Group} from "../models/group";
import {isTestMode} from "../testMode/flag";
import {shouldRunTaskWorkerInGateway} from "../workerRuntime";
import {ChannelManager} from "./channels/manager";
import {logError} from "./errors";
import {GroupQueue} from "./groupQueue";
import type {IpcCreateFeature, IpcRadioStream, IpcTriviaToggle} from "./ipc";
import {IpcWatcher} from "./ipc";
import {ensureGroupDirectory, getGroupMemoryPath, initGlobalMemory, writeMemory} from "./memory";
import {MessageLoop} from "./messageLoop";
import {DirectAgentRunner} from "./runners/direct";
import {MockAgentRunner} from "./runners/mock";
import {OpenAIAgentRunner} from "./runners/openai";
import type {AgentRunner} from "./runners/types";
import {PrWatcher} from "./services/prWatcher";
import {RadioTranscriber} from "./services/radioTranscriber";
import {registerSchedulerForWake, SchedulerService} from "./services/scheduler";
import {TaskWorkerService} from "./services/taskWorker";
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
  \`AppConfig.models.planner\` (default \`gpt-5.4\`). Drives the **blend**
  workflow conversationally. Writes plan drafts to
  \`docs/implementationPlans/<feature>.md\` inside this group folder.
- **Implementation** (phases \`implementing\` and \`complete\`) — Claude Agent
  SDK. Executes the approved plan via the **roast** workflow.

The user flips from planning to implementing by typing \`/roast\` or
\`/implement\` (or the \`!\`-prefixed forms) in the channel. The orchestrator
detects this and sets \`featurePhase\` on the group before handing to Claude.

## What YOU (the agent running this turn) must do

Because this same \`CLAUDE.md\` is in the system prompt for both runners, each
runner follows the part that applies to it:

### If you are the planner (OpenAI) — blend workflow

**Triage the request first:**

- **SIMPLE** — small bounded scope, clear precedent in the codebase, no
  unmade product decisions, no migrations/rollout concerns. **Skip all
  confirmation pauses**: research briefly, then produce the full plan
  (models, APIs, UI, phases, task list) in one pass, with an
  \`## Assumptions\` section listing everything you decided without asking.
- **COMPLEX or ambiguous** — anything else. Go through the full blend
  steps: ingest → research → **blocking questions (pause for answers;
  present options A/B/C, never pick silently)** → shape (models + APIs
  first, then UI/phases/risks) → generate the plan.

Rules either way:

- Never output application source code. Your job is plan prose, tables, and
  task lists.
- When you emit the final plan, wrap it in a \`\`\`markdown ... \`\`\` fenced
  block so the orchestrator can persist it.
- When the plan is done and the user is happy, tell them to type
  \`/roast\` to hand off to implementation.

### If you are the implementor (Claude Agent SDK) — roast workflow

- The plan already exists at
  \`docs/implementationPlans/${featureName}.md\` (written by the planner).
  Read it first.
- **Always work in a dedicated git worktree for the PR** — never on the
  main checkout. Create it off the default branch with a kebab-case branch
  name, then set up the environment by running \`bun bootstrap\` at the
  worktree root (all projects support it; fall back to \`bun install\` if
  missing and say so).
- Implement via TDD in small, behavior-scoped commits. Mark tasks complete
  in the plan document as you go.
- Post periodic progress updates in the channel.
- All service credentials and config live in \`AppConfig\` (loaded via
  \`loadAppConfig()\`). Do not read API keys or endpoints from ad-hoc env
  vars — go through AppConfig.
- When everything is done, open a PR from the worktree, then summarize what
  shipped and link the final plan and PR.

## Hard rules (both runners)

- **Never** write implementation code during the \`planning\` phase.
- **Never** start roast before the user has approved the plan.
- If the user changes scope mid-flight, re-run the affected blend step
  rather than patching code ad-hoc. If we're already in \`implementing\`, the
  operator can manually reset \`Group.featurePhase\` back to \`planning\`.
- Prefer small, verifiable commits.
`;
};

const FEATURE_CHANNEL_GREETING = (
  featureName: string,
  plannerModel: string,
  hasRequest: boolean
): string => {
  const kickoff = hasRequest
    ? `I've already kicked off planning from your original request — a first pass is on its way. Add any constraints or corrections here and I'll fold them in.`
    : `To kick things off: what are you trying to build, and why? A few sentences is enough — I'll shape it from there.`;
  return (
    `Feature channel ready for *${featureName}*! :sparkles:\n\n` +
    `*You don't need to \`@Shade\` me in this channel* — every message you send here goes straight to me.\n\n` +
    `Here's how we'll work in this channel:\n` +
    `1. *Planning (blend)* — I'll shape the idea into an implementation plan using \`${plannerModel}\`. Simple asks get a plan straight away; bigger or ambiguous ones get clarifying questions first.\n` +
    `2. *Handoff* — when you're happy with the plan, type \`/roast\` (or \`/implement\`). That flips this channel to implementation mode.\n` +
    `3. *Implementation (roast)* — the Claude Agent SDK spins up a dedicated worktree, bootstraps it with \`bun bootstrap\`, and executes the plan end-to-end toward a PR.\n\n` +
    kickoff
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
  scheduler: SchedulerService;
  taskWorker: TaskWorkerService;
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

  // Test mode (IP-012): every agent turn runs through the deterministic mock —
  // no Anthropic/OpenAI calls. The single runner instance is shared with
  // GroupQueue, PrWatcher, and TaskWorkerService below, so one swap covers
  // every consumer; the mock also stands in for the OpenAI planner.
  const runner: AgentRunner = isTestMode() ? new MockAgentRunner() : new DirectAgentRunner();
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

    // Create the Feature record so the frontend Features screen tracks this
    // feature — the Slack flow previously created only the channel + group,
    // leaving UI-created and Slack-created features inconsistent.
    try {
      await Feature.create({
        name: data.name,
        description: data.description ?? data.request?.slice(0, 500),
        groupId: group._id,
        status: "planned",
      });
    } catch (err) {
      logError(`Failed to create Feature record for ${data.name}`, err);
    }

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
    const appConfig = await loadAppConfig();
    const plannerModel = appConfig.models?.planner || "gpt-5.4";

    await channelManager.sendMessage(
      sourceGroup.channelId.toString(),
      slackChannelId,
      FEATURE_CHANNEL_GREETING(data.name, plannerModel, Boolean(data.request))
    );

    // Seed the channel with the user's original request so blend planning
    // starts immediately — the message loop picks this up like any inbound
    // message and hands it to the planner. Without it the user would have to
    // repeat themselves in the new channel.
    if (data.request) {
      try {
        const {Message} = await import("../models/message");
        await Message.create({
          groupId: group._id,
          channelId: sourceGroup.channelId,
          sender: `<@${data.senderExternalId}>`,
          senderExternalId: data.senderExternalId,
          content: data.request,
          isFromBot: false,
          metadata: {source: "create_feature_seed"},
        });
        logger.info(`Seeded #${data.name} with the original feature request — planning starts now`);
      } catch (err) {
        logError(`Failed to seed feature request message for ${data.name}`, err);
      }
    }

    logger.info(`Feature channel created: #${data.name} (${slackChannelId}), group ${group._id}`);
  });

  // Radio transcriber, PR watcher, and trivia monitor talk to external
  // services (radio streams/Deepgram, GitHub/Anthropic, Anthropic/webhooks) —
  // test mode constructs them for a uniform OrchestratorState but never
  // starts them.
  const radioTranscriber = new RadioTranscriber(channelManager);
  const prWatcher = new PrWatcher(channelManager, runner);
  const triviaMonitor = new TriviaMonitor(channelManager);
  messageLoop.setTriviaMonitor(triviaMonitor);

  if (isTestMode()) {
    logger.info("Test mode: radio transcriber, PR watcher, and trivia monitor not started");
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
  const taskWorker = new TaskWorkerService({runner, channelManager});
  const appConfig = await loadAppConfig();
  if (shouldRunTaskWorkerInGateway(appConfig)) {
    try {
      await taskWorker.start();
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
    triviaMonitor,
    scheduler,
    taskWorker,
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
  registerSchedulerForWake(null);
  state.scheduler.stop();
  state.taskWorker.stop();

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
