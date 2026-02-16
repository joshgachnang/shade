import fs from "node:fs/promises";
import path from "node:path";
import {logger} from "@terreno/api";
import {config} from "../config";
import {Group} from "../models/group";
import {ScheduledTask} from "../models/scheduledTask";

export interface IpcMessage {
  type: "send_message";
  groupId: string;
  channelId: string;
  content: string;
  targetGroupId?: string;
}

export interface IpcTaskAction {
  type: "create_task" | "update_task" | "pause_task" | "resume_task" | "cancel_task";
  groupId: string;
  taskId?: string;
  data?: Record<string, unknown>;
}

type IpcFile = IpcMessage | IpcTaskAction;

type SendMessageFn = (
  channelId: string,
  targetGroupExternalId: string,
  content: string
) => Promise<void>;

export class IpcWatcher {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private sendMessage: SendMessageFn | null = null;

  setSendMessage(fn: SendMessageFn): void {
    this.sendMessage = fn;
  }

  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      this.poll().catch((err) => {
        logger.error(`IPC poll error: ${err}`);
      });
    }, config.pollIntervals.ipc);

    logger.info(`IPC watcher started (interval: ${config.pollIntervals.ipc}ms)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("IPC watcher stopped");
    }
  }

  private async poll(): Promise<void> {
    const ipcDir = config.paths.ipc;

    let files: string[];
    try {
      files = await fs.readdir(ipcDir);
    } catch {
      return;
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    if (jsonFiles.length === 0) {
      return;
    }

    for (const file of jsonFiles) {
      const filePath = path.join(ipcDir, file);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const ipcData = JSON.parse(content) as IpcFile;

        const isAuthorized = await this.checkAuthorization(ipcData);
        if (!isAuthorized) {
          logger.warn(`IPC authorization denied for ${file}`);
          await fs.unlink(filePath);
          continue;
        }

        await this.processIpcFile(ipcData);
        await fs.unlink(filePath);
        logger.debug(`Processed IPC file: ${file}`);
      } catch (err) {
        logger.error(`Failed to process IPC file ${file}: ${err}`);
        // Move failed files to avoid reprocessing
        try {
          await fs.rename(filePath, `${filePath}.failed`);
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

    if (ipcData.taskId) {
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
      case "create_task":
        await this.handleCreateTask(ipcData);
        break;
      case "update_task":
        await this.handleUpdateTask(ipcData);
        break;
      case "pause_task":
        await this.handlePauseTask(ipcData);
        break;
      case "resume_task":
        await this.handleResumeTask(ipcData);
        break;
      case "cancel_task":
        await this.handleCancelTask(ipcData);
        break;
      default:
        logger.warn(`Unknown IPC type: ${(ipcData as {type: string}).type}`);
    }
  }

  private async handleSendMessage(data: IpcMessage): Promise<void> {
    if (!this.sendMessage) {
      logger.warn("No sendMessage handler registered for IPC");
      return;
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

  private async handlePauseTask(data: IpcTaskAction): Promise<void> {
    if (!data.taskId) {
      return;
    }
    await ScheduledTask.findByIdAndUpdate(data.taskId, {$set: {status: "paused"}});
    logger.info(`IPC: paused task ${data.taskId}`);
  }

  private async handleResumeTask(data: IpcTaskAction): Promise<void> {
    if (!data.taskId) {
      return;
    }
    await ScheduledTask.findByIdAndUpdate(data.taskId, {$set: {status: "active"}});
    logger.info(`IPC: resumed task ${data.taskId}`);
  }

  private async handleCancelTask(data: IpcTaskAction): Promise<void> {
    if (!data.taskId) {
      return;
    }
    await ScheduledTask.findByIdAndUpdate(data.taskId, {$set: {status: "cancelled"}});
    logger.info(`IPC: cancelled task ${data.taskId}`);
  }
}
