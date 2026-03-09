import {logger} from "@terreno/api";
import type {Types} from "mongoose";
import {config} from "../config";
import {TaskRunLog} from "../models/taskRunLog";
import type {AgentSessionDocument, GroupDocument, MessageDocument} from "../types";
import type {ChannelManager} from "./channels/manager";
import {logError} from "./errors";
import {buildSystemPrompt, ensureGroupDirectory} from "./memory";
import {buildPromptForGroup, formatOutboundMessage} from "./router";
import type {AgentRunner, AgentRunResult} from "./runners/types";
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
        logError(`Unhandled error in processNext for group ${groupId}`, err);
        this.activeRuns.set(groupId, false);
      });
    } catch (err) {
      logError(`Synchronous error starting processNext for group ${groupId}`, err);
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
      logError(`Agent run error for group ${item.group.name}`, err);
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

    const {prompt, messageIds} = await buildPromptForGroup(group, message);
    const session = await getOrCreateSession(groupId);
    const groupFolder = await ensureGroupDirectory(group.folder);
    const systemPrompt = await buildSystemPrompt(
      group.folder,
      `You are ${config.assistantName}, an AI assistant in the "${group.name}" group.`
    );

    const taskRunLog = await TaskRunLog.create({
      groupId: group._id,
      trigger: "message",
      classification: "internal",
      modelBackend: group.modelConfig.defaultBackend || "claude",
      modelName: group.modelConfig.defaultModel,
      status: "running",
      prompt: message.content,
      startedAt,
    });

    await this.safeAppendTranscript(session.transcriptPath, group.name, {
      type: "user_message",
      sender: message.sender,
      content: message.content,
      messageIds,
    });

    try {
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
        `Agent completed for group ${group.name}: status=${result.status}, duration=${result.durationMs}ms`
      );

      await this.handleAgentSuccess(group, groupId, session, taskRunLog._id, result, messageIds);
    } catch (err) {
      logger.error(`Agent execution failed for group ${group.name}: ${err}`);
      await this.updateTaskRunLogStatus(taskRunLog._id, "failed", {
        error: String(err),
        durationMs: Date.now() - startedAt.getTime(),
      });
      throw err;
    }
  }

  private async handleAgentSuccess(
    group: GroupDocument,
    groupId: string,
    session: AgentSessionDocument,
    taskRunLogId: Types.ObjectId,
    result: AgentRunResult,
    messageIds: string[]
  ): Promise<void> {
    const outbound = formatOutboundMessage(result.output, config.assistantName);

    if (outbound) {
      try {
        await this.channelManager.sendMessageToGroup(groupId, outbound);
      } catch (err) {
        logger.error(`Failed to send response to group ${group.name}: ${err}`);
      }
    }

    try {
      await updateSessionActivity(session.sessionId);
    } catch (err) {
      logger.warn(`Failed to update session activity for ${session.sessionId}: ${err}`);
    }

    await this.updateTaskRunLogStatus(
      taskRunLogId,
      result.status === "completed" ? "completed" : "failed",
      {
        result: result.output,
        error: result.error,
        durationMs: result.durationMs,
      }
    );

    await this.safeAppendTranscript(session.transcriptPath, group.name, {
      type: "agent_response",
      output: result.output,
      status: result.status,
      durationMs: result.durationMs,
    });

    try {
      const {Message} = await import("../models/message");
      await Message.updateMany({_id: {$in: messageIds}}, {$set: {processedAt: new Date()}});
    } catch (err) {
      logger.warn(`Failed to mark messages as processed for group ${group.name}: ${err}`);
    }

    logger.info(
      `Agent run completed for group ${group.name} in ${result.durationMs}ms (status: ${result.status})`
    );
  }

  private async safeAppendTranscript(
    transcriptPath: string,
    groupName: string,
    entry: Record<string, unknown>
  ): Promise<void> {
    try {
      await appendToTranscript(transcriptPath, entry);
    } catch (err) {
      logger.warn(`Failed to append to transcript for group ${groupName}: ${err}`);
    }
  }

  private async updateTaskRunLogStatus(
    taskRunLogId: Types.ObjectId,
    status: string,
    extra: Record<string, unknown>
  ): Promise<void> {
    try {
      await TaskRunLog.findByIdAndUpdate(taskRunLogId, {
        $set: {status, completedAt: new Date(), ...extra},
      });
    } catch (err) {
      logger.warn(`Failed to update task run log: ${err}`);
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
