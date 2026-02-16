import {logger} from "@terreno/api";
import {config} from "../config";
import {TaskRunLog} from "../models/taskRunLog";
import type {GroupDocument, MessageDocument} from "../types";
import type {ChannelManager} from "./channels/manager";
import {ensureGroupDirectory} from "./memory";
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

    logger.debug(`Enqueued message for group ${group.name} (queue size: ${queue.length})`);

    // Try to process immediately (fire-and-forget)
    void this.processNext(groupId);
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

  private async processNext(groupId: string): Promise<void> {
    // Check per-group concurrency
    if (this.activeRuns.get(groupId)) {
      return;
    }

    // Check global concurrency
    if (this.globalActiveCount >= config.concurrency.maxGlobal) {
      logger.debug(
        `Global concurrency limit reached (${this.globalActiveCount}/${config.concurrency.maxGlobal})`
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

    try {
      await this.executeAgentRun(item);
    } catch (err) {
      logger.error(`Agent run error for group ${item.group.name}: ${err}`);
      await this.handleFailure(item, String(err));
    } finally {
      this.activeRuns.set(groupId, false);
      this.globalActiveCount--;

      // Process next item in queue (fire-and-forget)
      void this.processNext(groupId);
    }
  }

  private async executeAgentRun(item: QueuedItem): Promise<void> {
    const {group, message} = item;
    const groupId = group._id.toString();
    const startedAt = new Date();

    // Build the prompt from conversation context
    const {prompt, messageIds} = await buildPromptForGroup(group, message);

    // Get or create session
    const session = await getOrCreateSession(groupId);

    // Ensure group directory exists
    const groupFolder = await ensureGroupDirectory(group.folder);

    // Create task run log
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

    // Log to transcript
    await appendToTranscript(session.transcriptPath, {
      type: "user_message",
      sender: message.sender,
      content: message.content,
      messageIds,
    });

    try {
      // Execute the agent
      const result = await this.runner.run({
        groupId,
        groupFolder,
        sessionId: session.sessionId,
        prompt,
        systemPrompt: `You are ${config.assistantName}, an AI assistant in the "${group.name}" group.`,
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

      // Format outbound message
      const outbound = formatOutboundMessage(result.output, config.assistantName);

      // Send response if there's output
      if (outbound) {
        await this.channelManager.sendMessageToGroup(groupId, outbound);
      }

      // Update session
      await updateSessionActivity(session.sessionId);

      // Update task run log
      await TaskRunLog.findByIdAndUpdate(taskRunLog._id, {
        $set: {
          status: result.status === "completed" ? "completed" : "failed",
          result: result.output,
          error: result.error,
          durationMs: result.durationMs,
          completedAt: new Date(),
        },
      });

      // Log to transcript
      await appendToTranscript(session.transcriptPath, {
        type: "agent_response",
        output: result.output,
        status: result.status,
        durationMs: result.durationMs,
      });

      // Mark messages as processed
      const {Message} = await import("../models/message");
      await Message.updateMany({_id: {$in: messageIds}}, {$set: {processedAt: new Date()}});

      logger.info(
        `Agent run completed for group ${group.name} in ${result.durationMs}ms (status: ${result.status})`
      );
    } catch (err) {
      await TaskRunLog.findByIdAndUpdate(taskRunLog._id, {
        $set: {
          status: "failed",
          error: String(err),
          durationMs: Date.now() - startedAt.getTime(),
          completedAt: new Date(),
        },
      });

      throw err;
    }
  }

  private async handleFailure(item: QueuedItem, _error: string): Promise<void> {
    if (item.retryCount >= MAX_RETRIES) {
      logger.error(
        `Max retries (${MAX_RETRIES}) reached for group ${item.group.name}, dropping message`
      );
      return;
    }

    const delay = BASE_RETRY_DELAY_MS * 2 ** item.retryCount;
    logger.warn(
      `Retrying group ${item.group.name} in ${delay}ms (attempt ${item.retryCount + 1}/${MAX_RETRIES})`
    );

    item.retryCount++;

    setTimeout(() => {
      const groupId = item.group._id.toString();
      if (!this.queues.has(groupId)) {
        this.queues.set(groupId, []);
      }
      // Add to front of queue for retry
      this.queues.get(groupId)!.unshift(item);
      void this.processNext(groupId);
    }, delay);
  }
}
