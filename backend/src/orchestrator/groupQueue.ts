import {logger} from "@terreno/api";
import {config} from "../config";
import {AIRequest} from "../models/aiRequest";
import {TaskRunLog} from "../models/taskRunLog";
import type {GroupDocument, MessageDocument} from "../types";
import type {ChannelManager} from "./channels/manager";
import {
  ensureGroupDirectory,
  getGlobalMemoryPath,
  getGroupMemoryPath,
  getSoulPath,
  readMemory,
} from "./memory";
import {buildPromptForGroup, formatOutboundMessage} from "./router";
import type {AgentRunner} from "./runners/types";
import {appendToTranscript, getOrCreateSession, updateSessionActivity} from "./sessions";

interface QueuedItem {
  group: GroupDocument;
  message: MessageDocument;
  retryCount: number;
}

const BASE_RETRY_DELAY_MS = 5000;
const MAX_RETRIES = 5;

export class GroupQueue {
  private queues = new Map<string, QueuedItem[]>();
  private activeRuns = new Map<string, boolean>();
  private runner: AgentRunner;
  private channelManager: ChannelManager;
  private globalActiveCount = 0;

  constructor(runner: AgentRunner, channelManager: ChannelManager) {
    this.runner = runner;
    this.channelManager = channelManager;
  }

  enqueue(group: GroupDocument, message: MessageDocument): void {
    const groupId = group._id.toString();

    if (!this.queues.has(groupId)) {
      this.queues.set(groupId, []);
    }

    const queue = this.queues.get(groupId)!;
    queue.push({group, message, retryCount: 0});

    logger.info(
      `Enqueued message for group ${group.name} (queue depth: ${queue.length}, active agents: ${this.globalActiveCount})`
    );

    this.safeProcessNext(groupId);
  }

  getQueueDepth(groupId: string): number {
    return this.queues.get(groupId)?.length ?? 0;
  }

  isGroupActive(groupId: string): boolean {
    return this.activeRuns.get(groupId) ?? false;
  }

  getActiveAgentCount(): number {
    return this.globalActiveCount;
  }

  /** Safely kick off processNext without risk of unhandled rejection */
  private safeProcessNext(groupId: string): void {
    try {
      this.processNext(groupId).catch((err) => {
        logger.error(`Unhandled error in processNext for group ${groupId}: ${err}`);
        if (err instanceof Error) {
          logger.error(err.stack ?? "no stack trace");
        }
        // Ensure we don't leave the group stuck as active
        this.activeRuns.set(groupId, false);
      });
    } catch (err) {
      logger.error(`Synchronous error starting processNext for group ${groupId}: ${err}`);
      this.activeRuns.set(groupId, false);
    }
  }

  private async processNext(groupId: string): Promise<void> {
    // Check per-group concurrency
    if (this.activeRuns.get(groupId)) {
      logger.debug(`Group ${groupId} already has an active run, skipping`);
      return;
    }

    // Check global concurrency
    if (this.globalActiveCount >= config.concurrency.maxGlobal) {
      logger.debug(
        `Global concurrency limit reached (${this.globalActiveCount}/${config.concurrency.maxGlobal}), deferring group ${groupId}`
      );
      return;
    }

    const queue = this.queues.get(groupId);
    if (!queue || queue.length === 0) {
      return;
    }

    const item = queue.shift()!;
    this.activeRuns.set(groupId, true);
    this.globalActiveCount++;

    logger.info(
      `Starting agent run for group ${item.group.name} (active: ${this.globalActiveCount}, remaining in queue: ${queue.length})`
    );

    try {
      await this.executeAgentRun(item);
    } catch (err) {
      logger.error(`Agent run error for group ${item.group.name}: ${err}`);
      if (err instanceof Error) {
        logger.error(err.stack ?? "no stack trace");
      }
      try {
        await this.handleFailure(item, String(err));
      } catch (failErr) {
        logger.error(`Error in handleFailure for group ${item.group.name}: ${failErr}`);
      }
    } finally {
      this.activeRuns.set(groupId, false);
      this.globalActiveCount--;
      logger.debug(
        `Agent run finished for group ${item.group.name} (active: ${this.globalActiveCount})`
      );

      // Process next item in queue
      this.safeProcessNext(groupId);
    }
  }

  private async executeAgentRun(item: QueuedItem): Promise<void> {
    const {group, message} = item;
    const groupId = group._id.toString();
    const startedAt = new Date();

    logger.info(
      `Executing agent run for group ${group.name}, trigger: "${message.content.substring(0, 80)}"`
    );

    // Build the prompt from conversation context
    let prompt: string;
    let messageIds: string[];
    try {
      const result = await buildPromptForGroup(group, message);
      prompt = result.prompt;
      messageIds = result.messageIds;
      logger.debug(
        `Built prompt for group ${group.name}: ${messageIds.length} messages, ${prompt.length} chars`
      );
    } catch (err) {
      logger.error(`Failed to build prompt for group ${group.name}: ${err}`);
      throw err;
    }

    // Get or create session
    let session;
    try {
      session = await getOrCreateSession(groupId);
      logger.debug(`Using session ${session.sessionId} for group ${group.name}`);
    } catch (err) {
      logger.error(`Failed to get/create session for group ${group.name}: ${err}`);
      throw err;
    }

    // Ensure group directory exists
    let groupFolder: string;
    try {
      groupFolder = await ensureGroupDirectory(group.folder);
    } catch (err) {
      logger.error(`Failed to ensure group directory for ${group.name}: ${err}`);
      throw err;
    }

    // Build system prompt from SOUL.md + memory files
    const systemPromptParts: string[] = [];

    const soul = await readMemory(getSoulPath());
    if (soul) {
      systemPromptParts.push(soul);
    }

    const globalMemory = await readMemory(getGlobalMemoryPath());
    if (globalMemory) {
      systemPromptParts.push(globalMemory);
    }

    const groupMemory = await readMemory(getGroupMemoryPath(group.folder));
    if (groupMemory) {
      systemPromptParts.push(groupMemory);
    }

    // Fallback if no soul/memory files exist
    if (systemPromptParts.length === 0) {
      systemPromptParts.push(
        `You are ${config.assistantName}, an AI assistant in the "${group.name}" group.`
      );
    }

    const systemPrompt = systemPromptParts.join("\n\n---\n\n");

    // Create task run log
    let taskRunLog;
    try {
      taskRunLog = await TaskRunLog.create({
        groupId: group._id,
        trigger: "message",
        classification: "internal",
        modelBackend: group.modelConfig.defaultBackend || "claude",
        modelName: group.modelConfig.defaultModel,
        status: "running",
        prompt: message.content,
        startedAt,
      });
    } catch (err) {
      logger.error(`Failed to create task run log for group ${group.name}: ${err}`);
      throw err;
    }

    // Log to transcript (non-fatal)
    try {
      await appendToTranscript(session.transcriptPath, {
        type: "user_message",
        sender: message.sender,
        content: message.content,
        messageIds,
      });
    } catch (err) {
      logger.warn(`Failed to append to transcript for group ${group.name}: ${err}`);
    }

    try {
      // Execute the agent
      logger.info(`Invoking agent runner for group ${group.name}...`);
      const result = await this.runner.run({
        groupId,
        groupFolder,
        sessionId: session.sessionId,
        prompt,
        systemPrompt,
        modelBackend: group.modelConfig.defaultBackend || "claude",
        modelName: group.modelConfig.defaultModel,
        env: {
          SHADE_GROUP_ID: groupId,
          SHADE_CHANNEL_ID: group.channelId.toString(),
        },
        timeout: group.executionConfig.timeout || 300000,
        idleTimeout: group.executionConfig.idleTimeout || 60000,
        resume: session.messageCount > 0,
        resumeSessionAt: session.resumeSessionAt,
      });

      logger.info(
        `Agent completed for group ${group.name}: status=${result.status}, duration=${result.durationMs}ms, output=${result.output.length} chars`
      );

      // Format outbound message
      const outbound = formatOutboundMessage(result.output, config.assistantName);

      // Send response if there's output
      if (outbound) {
        logger.debug(`Sending ${outbound.length}-char response to group ${group.name}`);
        try {
          await this.channelManager.sendMessageToGroup(groupId, outbound);
        } catch (err) {
          logger.error(`Failed to send response to group ${group.name}: ${err}`);
        }
      } else {
        logger.debug(`No outbound message for group ${group.name} (empty output)`);
      }

      // Update session (non-fatal)
      try {
        await updateSessionActivity(session.sessionId);
      } catch (err) {
        logger.warn(`Failed to update session activity for ${session.sessionId}: ${err}`);
      }

      // Update task run log (non-fatal)
      try {
        await TaskRunLog.findByIdAndUpdate(taskRunLog._id, {
          $set: {
            status: result.status === "completed" ? "completed" : "failed",
            result: result.output,
            error: result.error,
            durationMs: result.durationMs,
            completedAt: new Date(),
          },
        });
      } catch (err) {
        logger.warn(`Failed to update task run log: ${err}`);
      }

      // Log AI request (non-fatal)
      try {
        await AIRequest.create({
          aiModel: group.modelConfig.defaultModel || "claude-sonnet-4-20250514",
          costUsd: result.costUsd,
          error: result.error,
          groupId: group._id,
          prompt: message.content,
          requestType: "agent",
          response: result.output.substring(0, 10000),
          responseTime: result.durationMs,
          sessionId: result.sessionId,
          status: result.status,
        });
      } catch (err) {
        logger.warn(`Failed to log AI request: ${err}`);
      }

      // Log to transcript (non-fatal)
      try {
        await appendToTranscript(session.transcriptPath, {
          type: "agent_response",
          output: result.output,
          status: result.status,
          durationMs: result.durationMs,
        });
      } catch (err) {
        logger.warn(`Failed to append agent response to transcript: ${err}`);
      }

      // Mark messages as processed (non-fatal)
      try {
        const {Message} = await import("../models/message");
        await Message.updateMany({_id: {$in: messageIds}}, {$set: {processedAt: new Date()}});
        logger.debug(`Marked ${messageIds.length} messages as processed for group ${group.name}`);
      } catch (err) {
        logger.warn(`Failed to mark messages as processed for group ${group.name}: ${err}`);
      }

      logger.info(
        `Agent run completed for group ${group.name} in ${result.durationMs}ms (status: ${result.status})`
      );
    } catch (err) {
      logger.error(`Agent execution failed for group ${group.name}: ${err}`);

      try {
        await TaskRunLog.findByIdAndUpdate(taskRunLog._id, {
          $set: {
            status: "failed",
            error: String(err),
            durationMs: Date.now() - startedAt.getTime(),
            completedAt: new Date(),
          },
        });
      } catch (dbErr) {
        logger.warn(`Failed to update task run log after failure: ${dbErr}`);
      }

      throw err;
    }
  }

  private async handleFailure(item: QueuedItem, error: string): Promise<void> {
    if (item.retryCount >= MAX_RETRIES) {
      logger.error(
        `Max retries (${MAX_RETRIES}) reached for group ${item.group.name}, dropping message: "${item.message.content.substring(0, 80)}"`
      );
      return;
    }

    const delay = BASE_RETRY_DELAY_MS * 2 ** item.retryCount;
    logger.warn(
      `Retrying group ${item.group.name} in ${delay}ms (attempt ${item.retryCount + 1}/${MAX_RETRIES}, error: ${error.substring(0, 200)})`
    );

    item.retryCount++;

    setTimeout(() => {
      const groupId = item.group._id.toString();
      if (!this.queues.has(groupId)) {
        this.queues.set(groupId, []);
      }
      // Add to front of queue for retry
      this.queues.get(groupId)!.unshift(item);
      this.safeProcessNext(groupId);
    }, delay);
  }
}
