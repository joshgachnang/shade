import fs from "node:fs/promises";
import path from "node:path";
import {logger} from "@terreno/api";
import {paths} from "../config";
import {loadAppConfig} from "../models/appConfig";
import {Group} from "../models/group";
import {ScheduledTask} from "../models/scheduledTask";
import type {RichResponse} from "./responses/schema";

export interface IpcMessage {
  type: "send_message";
  groupId: string;
  channelId: string;
  content: string;
  targetGroupId?: string;
  /** Set by respond_with_card / send_message MCP tools — enables dedupe in the same agent run. */
  agentRunId?: string;
}

export interface IpcRichResponse {
  type: "rich_response";
  groupId: string;
  channelId: string;
  agentRunId?: string;
  threadTs?: string;
  payload: RichResponse;
}

export interface IpcTaskAction {
  type: "create_task" | "update_task" | "pause_task" | "resume_task" | "cancel_task";
  groupId: string;
  taskId?: string;
  data?: Record<string, unknown>;
}

export interface IpcReaction {
  type: "add_reaction";
  groupId: string;
  channelId: string;
  messageTs: string;
  emoji: string;
}

export interface IpcCreateFeature {
  type: "create_feature";
  groupId: string;
  channelId: string;
  name: string;
  description?: string;
  senderExternalId: string;
}

export interface IpcRadioStream {
  type: "start_radio_stream" | "stop_radio_stream";
  groupId: string;
  radioStreamId: string;
}

export interface IpcTriviaToggle {
  type: "toggle_trivia_auto_search";
  groupId: string;
  enabled: boolean;
}

type IpcFile =
  | IpcMessage
  | IpcRichResponse
  | IpcTaskAction
  | IpcReaction
  | IpcCreateFeature
  | IpcRadioStream
  | IpcTriviaToggle;

type SendMessageFn = (
  channelId: string,
  targetGroupExternalId: string,
  content: string
) => Promise<void>;

type SendRichMessageFn = (
  groupId: string,
  payload: RichResponse,
  opts: {threadTs?: string}
) => Promise<void>;

type AddReactionFn = (
  channelId: string,
  groupExternalId: string,
  messageTs: string,
  emoji: string
) => Promise<void>;

type CreateFeatureFn = (data: IpcCreateFeature) => Promise<void>;
type RadioStreamFn = (data: IpcRadioStream) => Promise<void>;
type TriviaToggleFn = (data: IpcTriviaToggle) => Promise<void>;

/** Time window in ms during which a rich_response for a given agentRunId
 *  preempts a co-arriving send_message. Plenty for an IPC poll cycle. */
const DEDUPE_WINDOW_MS = 60_000;

export class IpcWatcher {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private sendMessage: SendMessageFn | null = null;
  private sendRichMessage: SendRichMessageFn | null = null;
  private addReaction: AddReactionFn | null = null;
  private createFeature: CreateFeatureFn | null = null;
  private radioStream: RadioStreamFn | null = null;
  private triviaToggle: TriviaToggleFn | null = null;
  /** Map of (groupId|agentRunId) -> expiry ts for rich responses that preempt plain sends. */
  private richEmittedRuns = new Map<string, number>();

  setSendMessage(fn: SendMessageFn): void {
    this.sendMessage = fn;
  }

  setSendRichMessage(fn: SendRichMessageFn): void {
    this.sendRichMessage = fn;
  }

  setAddReaction(fn: AddReactionFn): void {
    this.addReaction = fn;
  }

  setCreateFeature(fn: CreateFeatureFn): void {
    this.createFeature = fn;
  }

  setRadioStream(fn: RadioStreamFn): void {
    this.radioStream = fn;
  }

  setTriviaToggle(fn: TriviaToggleFn): void {
    this.triviaToggle = fn;
  }

  async start(): Promise<void> {
    if (this.intervalId) {
      return;
    }

    const appConfig = await loadAppConfig();
    const interval = appConfig.pollIntervals.ipc;

    this.intervalId = setInterval(() => {
      this.poll().catch((err) => {
        logger.error(`IPC poll error: ${err}`);
      });
    }, interval);

    logger.debug(`IPC watcher started (interval: ${interval}ms)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("IPC watcher stopped");
    }
  }

  private async poll(): Promise<void> {
    const ipcDir = paths.ipc;

    let files: string[];
    try {
      files = await fs.readdir(ipcDir);
    } catch (err) {
      logger.debug(`IPC directory not readable (${ipcDir}): ${err}`);
      return;
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    if (jsonFiles.length === 0) {
      return;
    }

    for (const file of jsonFiles) {
      const filePath = path.join(ipcDir, file);
      try {
        // Move file to .processing to prevent double-execution from concurrent polls
        const processingPath = `${filePath}.processing`;
        try {
          await fs.rename(filePath, processingPath);
        } catch {
          // File already picked up by another poll cycle
          continue;
        }

        const content = await fs.readFile(processingPath, "utf-8");
        const ipcData = JSON.parse(content) as IpcFile;

        const isAuthorized = await this.checkAuthorization(ipcData);
        if (!isAuthorized) {
          logger.warn(`IPC authorization denied for ${file}`);
          await fs.unlink(processingPath);
          continue;
        }

        await this.processIpcFile(ipcData);
        await fs.unlink(processingPath);
        logger.debug(`Processed IPC file: ${file}`);
      } catch (err) {
        logger.error(`Failed to process IPC file ${file}: ${err}`);
        // Clean up processing file if it exists
        try {
          await fs.rename(`${filePath}.processing`, `${filePath}.failed`);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  private async checkAuthorization(ipcData: IpcFile): Promise<boolean> {
    const sourceGroup = await Group.findById(ipcData.groupId);
    if (!sourceGroup) {
      return false;
    }

    // Main group can do anything
    if (sourceGroup.isMain) {
      return true;
    }

    // Non-main groups can only act within their own group
    if (ipcData.type === "send_message") {
      const targetGroupId = ipcData.targetGroupId ?? ipcData.groupId;
      return targetGroupId === ipcData.groupId;
    }

    if (ipcData.type === "rich_response") {
      // Rich responses always target the source group (the schema has no
      // targetGroupId today). Allowing only same-group keeps parity with
      // send_message's authorization rule.
      return true;
    }

    // Feature channel creation, radio stream control, and trivia toggle require main group
    if (
      ipcData.type === "create_feature" ||
      ipcData.type === "start_radio_stream" ||
      ipcData.type === "stop_radio_stream" ||
      ipcData.type === "toggle_trivia_auto_search"
    ) {
      return false;
    }

    // Reactions are always scoped to the agent's own channel
    if (ipcData.type === "add_reaction") {
      return true;
    }

    if ("taskId" in ipcData && ipcData.taskId) {
      const task = await ScheduledTask.findById(ipcData.taskId);
      if (task && task.groupId.toString() !== ipcData.groupId) {
        return false;
      }
    }

    return true;
  }

  private async processIpcFile(ipcData: IpcFile): Promise<void> {
    switch (ipcData.type) {
      case "send_message":
        await this.handleSendMessage(ipcData);
        break;
      case "rich_response":
        await this.handleRichResponse(ipcData);
        break;
      case "add_reaction":
        await this.handleAddReaction(ipcData);
        break;
      case "create_feature":
        await this.handleCreateFeature(ipcData);
        break;
      case "start_radio_stream":
      case "stop_radio_stream":
        await this.handleRadioStream(ipcData);
        break;
      case "toggle_trivia_auto_search":
        await this.handleTriviaToggle(ipcData);
        break;
      case "create_task":
        await this.handleCreateTask(ipcData);
        break;
      case "update_task":
        await this.handleUpdateTask(ipcData);
        break;
      case "pause_task":
        await this.handleTaskStatusChange(ipcData, "paused");
        break;
      case "resume_task":
        await this.handleTaskStatusChange(ipcData, "active");
        break;
      case "cancel_task":
        await this.handleTaskStatusChange(ipcData, "cancelled");
        break;
      default:
        logger.warn(`Unknown IPC type: ${(ipcData as {type: string}).type}`);
    }
  }

  private async handleCreateFeature(data: IpcCreateFeature): Promise<void> {
    if (!this.createFeature) {
      logger.warn("No createFeature handler registered for IPC");
      return;
    }

    try {
      await this.createFeature(data);
      logger.info(`IPC: created feature channel "${data.name}" for group ${data.groupId}`);
    } catch (err) {
      logger.error(`IPC: failed to create feature channel "${data.name}": ${err}`);
    }
  }

  private async handleAddReaction(data: IpcReaction): Promise<void> {
    if (!this.addReaction) {
      logger.warn("No addReaction handler registered for IPC");
      return;
    }

    const group = await Group.findById(data.groupId);
    if (!group) {
      logger.error(`Group ${data.groupId} not found for IPC reaction`);
      return;
    }

    await this.addReaction(data.channelId, group.externalId, data.messageTs, data.emoji);
    logger.info(`IPC: added reaction ${data.emoji} in group ${data.groupId}`);
  }

  private async handleSendMessage(data: IpcMessage): Promise<void> {
    if (!this.sendMessage) {
      logger.warn("No sendMessage handler registered for IPC");
      return;
    }

    // Dedupe: if a rich_response with the same agentRunId was processed in
    // the same window, drop this plain send. The card already covered it.
    if (data.agentRunId) {
      const key = `${data.groupId}|${data.agentRunId}`;
      const expiry = this.richEmittedRuns.get(key);
      if (expiry && expiry > Date.now()) {
        logger.debug(
          `IPC: dropping send_message for agentRunId=${data.agentRunId} — rich_response already emitted`
        );
        return;
      }
    }

    const targetGroupId = data.targetGroupId ?? data.groupId;
    const targetGroup = await Group.findById(targetGroupId);
    if (!targetGroup) {
      logger.error(`Target group ${targetGroupId} not found for IPC message`);
      return;
    }

    await this.sendMessage(data.channelId, targetGroup.externalId, data.content);
    logger.info(`IPC: sent message to group ${targetGroupId}`);
  }

  private async handleRichResponse(data: IpcRichResponse): Promise<void> {
    if (!this.sendRichMessage) {
      logger.warn("No sendRichMessage handler registered for IPC");
      return;
    }

    // Mark this run so a co-arriving send_message gets deduped.
    if (data.agentRunId) {
      this.richEmittedRuns.set(`${data.groupId}|${data.agentRunId}`, Date.now() + DEDUPE_WINDOW_MS);
      // Opportunistic cleanup: every N inserts, drop expired entries.
      if (this.richEmittedRuns.size > 256) {
        const now = Date.now();
        for (const [k, v] of this.richEmittedRuns) {
          if (v <= now) this.richEmittedRuns.delete(k);
        }
      }
    }

    try {
      await this.sendRichMessage(data.groupId, data.payload, {threadTs: data.threadTs});
      logger.info(
        `IPC: sent rich response to group ${data.groupId} (${data.payload.cards.length} card(s))`
      );
    } catch (err) {
      logger.error(`IPC: rich_response handler failed for group ${data.groupId}: ${err}`);
    }
  }

  private async handleCreateTask(data: IpcTaskAction): Promise<void> {
    const taskData = data.data ?? {};
    await ScheduledTask.create({
      groupId: data.groupId,
      ...taskData,
    });
    logger.info(`IPC: created task for group ${data.groupId}`);
  }

  private async handleUpdateTask(data: IpcTaskAction): Promise<void> {
    if (!data.taskId) {
      return;
    }
    await ScheduledTask.findByIdAndUpdate(data.taskId, {$set: data.data ?? {}});
    logger.info(`IPC: updated task ${data.taskId}`);
  }

  private async handleRadioStream(data: IpcRadioStream): Promise<void> {
    if (!this.radioStream) {
      logger.warn("No radioStream handler registered for IPC");
      return;
    }

    try {
      await this.radioStream(data);
      logger.info(`IPC: ${data.type} for radio stream ${data.radioStreamId}`);
    } catch (err) {
      logger.error(`IPC: failed to ${data.type} radio stream ${data.radioStreamId}: ${err}`);
    }
  }

  private async handleTriviaToggle(data: IpcTriviaToggle): Promise<void> {
    if (!this.triviaToggle) {
      logger.warn("No triviaToggle handler registered for IPC");
      return;
    }

    try {
      await this.triviaToggle(data);
      logger.info(`IPC: trivia auto-search ${data.enabled ? "enabled" : "disabled"}`);
    } catch (err) {
      logger.error(`IPC: failed to toggle trivia auto-search: ${err}`);
    }
  }

  private async handleTaskStatusChange(data: IpcTaskAction, status: string): Promise<void> {
    if (!data.taskId) {
      return;
    }
    await ScheduledTask.findByIdAndUpdate(data.taskId, {$set: {status}});
    logger.info(`IPC: set task ${data.taskId} to ${status}`);
  }
}
