import {logger} from "@terreno/api";
import type {Types} from "mongoose";
import {AIRequest} from "../models/aiRequest";
import {loadAppConfig} from "../models/appConfig";
import {TaskRunLog} from "../models/taskRunLog";
import type {AgentSessionDocument, GroupDocument, MessageDocument} from "../types";
import type {ChannelManager} from "./channels/manager";
import {logError} from "./errors";
import {buildSystemPrompt, ensureGroupDirectory} from "./memory";
import {buildPromptForGroup, formatOutboundMessage} from "./router";
import type {AgentRunner, AgentRunResult} from "./runners/types";
import {
  appendToTranscript,
  getOrCreateSession,
  updateResumeCheckpoint,
  updateSessionActivity,
} from "./sessions";

interface QueuedItem {
  group: GroupDocument;
  message: MessageDocument;
  retryCount: number;
  /** Set when resuming after a timeout */
  resumeSessionId?: string;
  resumeSessionAt?: string;
  resumeCount?: number;
}

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
    const appConfig = await loadAppConfig();
    if (this.globalActiveCount >= appConfig.concurrency.maxGlobal) {
      logger.debug(
        `Global concurrency limit reached (${this.globalActiveCount}/${appConfig.concurrency.maxGlobal}), deferring group ${groupId}`
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
    const channelId = group.channelId.toString();
    const messageTs = (message.metadata as {ts?: string})?.ts;
    const startedAt = new Date();
    const isResume = (item.resumeCount ?? 0) > 0;

    logger.info(
      `Executing agent run for group ${group.name}${isResume ? ` (resume #${item.resumeCount})` : ""}, trigger: "${message.content.substring(0, 80)}"`
    );

    // React with 👀 to acknowledge we're processing (only on first run)
    if (messageTs && !isResume) {
      await this.channelManager.addReaction(channelId, group.externalId, messageTs, "eyes");
    }

    // Build the prompt from conversation context
    const {prompt, messageIds} = await buildPromptForGroup(group, message);
    const session = await getOrCreateSession(groupId);
    const appConfig = await loadAppConfig();
    const groupFolder = await ensureGroupDirectory(group.folder);
    const systemPrompt = await buildSystemPrompt(
      group.folder,
      `You are ${appConfig.assistantName}, an AI assistant in the "${group.name}" group.`
    );

    const taskRunLog = await TaskRunLog.create({
      groupId: group._id,
      trigger: "message",
      classification: "internal",
      modelBackend: group.modelConfig.defaultBackend || "claude",
      modelName: group.modelConfig.defaultModel,
      status: "running",
      prompt: isResume ? `[resume #${item.resumeCount}] ${message.content}` : message.content,
      startedAt,
    });

    if (!isResume) {
      await this.safeAppendTranscript(session.transcriptPath, group.name, {
        type: "user_message",
        sender: message.sender,
        content: message.content,
        messageIds,
      });
    }

    // Progress reporting: send periodic updates to the channel
    let lastProgressSentAt = 0;
    const onProgress = async (text: string) => {
      const now = Date.now();
      if (now - lastProgressSentAt < appConfig.orchestrator.progressMessageIntervalMs) {
        return;
      }
      lastProgressSentAt = now;
      const elapsed = Math.round((now - startedAt.getTime()) / 1000);
      const preview = text.length > 200 ? `${text.slice(-200)}...` : text;
      try {
        await this.channelManager.sendMessageToGroup(
          groupId,
          `_Working on it (${elapsed}s)..._\n> ${preview}`
        );
      } catch (err) {
        logger.debug(`Failed to send progress update: ${err}`);
      }
    };

    try {
      logger.info(`Invoking agent runner for group ${group.name}...`);

      // Use resume checkpoint if this is a resumed run
      const shouldResume = isResume || session.messageCount > 0;
      const resumeAt = isResume ? item.resumeSessionAt : session.resumeSessionAt;

      const result = await this.runner.run({
        groupId,
        groupFolder,
        sessionId: session.sessionId,
        prompt: isResume
          ? "Continue where you left off. You were interrupted by a timeout — pick up your work and finish the task."
          : prompt,
        systemPrompt,
        modelBackend: group.modelConfig.defaultBackend || "claude",
        modelName: group.modelConfig.defaultModel,
        env: {
          SHADE_GROUP_ID: groupId,
          SHADE_CHANNEL_ID: group.channelId.toString(),
        },
        timeout: group.executionConfig.timeout || 300000,
        idleTimeout: group.executionConfig.idleTimeout || 60000,
        messageTs,
        senderExternalId: message.senderExternalId,
        resume: shouldResume,
        resumeSessionAt: resumeAt,
        onProgress,
      });

      // Handle timeout → save checkpoint and auto-resume
      if (result.status === "timeout" && result.resumeSessionId && result.lastMessageUuid) {
        const resumeCount = (item.resumeCount ?? 0) + 1;

        logger.info(
          `Agent timed out for group ${group.name}, saving checkpoint for resume #${resumeCount}`
        );

        // Save the resume checkpoint on the session
        await updateResumeCheckpoint(session.sessionId, result.lastMessageUuid);

        await this.safeAppendTranscript(session.transcriptPath, group.name, {
          type: "agent_timeout",
          output: result.output,
          durationMs: result.durationMs,
          resumeSessionId: result.resumeSessionId,
          lastMessageUuid: result.lastMessageUuid,
          resumeCount,
        });

        // Send partial output if any, plus a "continuing" notice
        if (result.output) {
          const partial = formatOutboundMessage(result.output, appConfig.assistantName);
          if (partial) {
            await this.channelManager.sendMessageToGroup(groupId, partial);
          }
        }

        if (resumeCount <= appConfig.orchestrator.maxResumes) {
          // Swap 👀 → ⏳ to show we're resuming
          if (messageTs) {
            await this.channelManager.removeReaction(
              channelId,
              group.externalId,
              messageTs,
              "eyes"
            );
            await this.channelManager.addReaction(
              channelId,
              group.externalId,
              messageTs,
              "hourglass_flowing_sand"
            );
          }

          await this.channelManager.sendMessageToGroup(
            groupId,
            `_Taking longer than expected — resuming automatically (${resumeCount}/${appConfig.orchestrator.maxResumes})..._`
          );

          // Re-enqueue with resume info
          const resumeItem: QueuedItem = {
            group: item.group,
            message: item.message,
            retryCount: item.retryCount,
            resumeSessionId: result.resumeSessionId,
            resumeSessionAt: result.lastMessageUuid,
            resumeCount,
          };

          const queueGroupId = group._id.toString();
          if (!this.queues.has(queueGroupId)) {
            this.queues.set(queueGroupId, []);
          }
          this.queues.get(queueGroupId)!.unshift(resumeItem);

          await this.updateTaskRunLogStatus(taskRunLog._id, "resumed", {
            result: result.output,
            durationMs: result.durationMs,
            resumeCount,
          });
          return;
        }

        // Max resumes reached — send final notice
        if (messageTs) {
          await this.channelManager.removeReaction(
            channelId,
            group.externalId,
            messageTs,
            "hourglass_flowing_sand"
          );
          await this.channelManager.addReaction(channelId, group.externalId, messageTs, "warning");
        }
        await this.channelManager.sendMessageToGroup(
          groupId,
          `_This task was too complex to finish in ${appConfig.orchestrator.maxResumes} attempts. Try breaking it into smaller requests._`
        );

        await this.updateTaskRunLogStatus(taskRunLog._id, "failed", {
          result: result.output,
          error: `Timed out after ${resumeCount} resume attempts`,
          durationMs: result.durationMs,
        });
        return;
      }

      // Normal completion or non-resumable failure
      if (messageTs) {
        await this.channelManager.removeReaction(channelId, group.externalId, messageTs, "eyes");
        await this.channelManager.removeReaction(
          channelId,
          group.externalId,
          messageTs,
          "hourglass_flowing_sand"
        );
        await this.channelManager.addReaction(
          channelId,
          group.externalId,
          messageTs,
          "white_check_mark"
        );
      }

      logger.info(
        `Agent completed for group ${group.name}: status=${result.status}, duration=${result.durationMs}ms`
      );

      await this.handleAgentSuccess(
        group,
        groupId,
        session,
        taskRunLog._id,
        result,
        message,
        messageIds
      );
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
    message: MessageDocument,
    messageIds: string[]
  ): Promise<void> {
    const appConfig = await loadAppConfig();
    const outbound = formatOutboundMessage(result.output, appConfig.assistantName);

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
    const appConfig = await loadAppConfig();
    const {maxRetries, baseRetryDelayMs} = appConfig.orchestrator;

    if (item.retryCount >= maxRetries) {
      logger.error(
        `Max retries (${maxRetries}) reached for group ${item.group.name}, dropping message: "${item.message.content.substring(0, 80)}"`
      );
      return;
    }

    const delay = baseRetryDelayMs * 2 ** item.retryCount;
    logger.warn(
      `Retrying group ${item.group.name} in ${delay}ms (attempt ${item.retryCount + 1}/${maxRetries}, error: ${error.substring(0, 200)})`
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
