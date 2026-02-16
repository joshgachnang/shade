import {logger} from "@terreno/api";
import {config} from "../config";
import {Message} from "../models/message";
import type {GroupDocument} from "../types";
import type {ChannelManager} from "./channels/manager";
import type {GroupQueue} from "./groupQueue";
import {shouldTrigger} from "./router";

export class MessageLoop {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private channelManager: ChannelManager;
  private groupQueue: GroupQueue;

  constructor(channelManager: ChannelManager, groupQueue: GroupQueue) {
    this.channelManager = channelManager;
    this.groupQueue = groupQueue;
  }

  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      this.poll().catch((err) => {
        logger.error(`Message loop poll error: ${err}`);
      });
    }, config.pollIntervals.message);

    logger.info(`Message loop started (interval: ${config.pollIntervals.message}ms)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("Message loop stopped");
    }
  }

  private async poll(): Promise<void> {
    const groups = this.channelManager.getAllGroups();

    for (const group of groups) {
      try {
        await this.pollGroup(group);
      } catch (err) {
        logger.error(`Error polling group ${group.name}: ${err}`);
      }
    }
  }

  private async pollGroup(group: GroupDocument): Promise<void> {
    // Skip if group already has an active agent
    const groupId = group._id.toString();
    if (this.groupQueue.isGroupActive(groupId)) {
      return;
    }

    // Find unprocessed, non-bot messages for this group
    const unprocessedMessages = await Message.find({
      groupId: group._id,
      processedAt: {$exists: false},
      isFromBot: false,
    }).sort({created: 1});

    if (unprocessedMessages.length === 0) {
      return;
    }

    // Find the first message that matches the trigger
    const triggeringMessage = unprocessedMessages.find((msg) => shouldTrigger(msg.content, group));

    if (!triggeringMessage) {
      return;
    }

    logger.info(
      `Trigger matched in group ${group.name}: "${triggeringMessage.content.substring(0, 50)}..." (${unprocessedMessages.length} pending)`
    );

    // Enqueue the triggering message — the group queue will build the full context
    this.groupQueue.enqueue(group, triggeringMessage);
  }
}
