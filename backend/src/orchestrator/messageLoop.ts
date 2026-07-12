import {logger} from "@terreno/api";
import {loadAppConfig} from "../models/appConfig";
import {Channel} from "../models/channel";
import {Message} from "../models/message";
import type {GroupDocument, MessageDocument} from "../types";
import {isHandleAllowed} from "../utils/smsAllowlist";
import type {ChannelManager} from "./channels/manager";
import {logError} from "./errors";
import type {GroupQueue} from "./groupQueue";
import {shouldTrigger} from "./router";
import type {TriviaMonitor} from "./services/triviaMonitor";

export class MessageLoop {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private channelManager: ChannelManager;
  private groupQueue: GroupQueue;
  private triviaMonitor: TriviaMonitor | null = null;
  /** In-flight guard: a forced tick racing the interval must not double-enqueue
   *  a message (processedAt is only set after the agent run completes). */
  private polling = false;
  /** channelId → channel type, so the per-tick allowlist gate doesn't hit the DB. */
  private channelTypeCache = new Map<string, string>();

  constructor(channelManager: ChannelManager, groupQueue: GroupQueue) {
    this.channelManager = channelManager;
    this.groupQueue = groupQueue;
  }

  setTriviaMonitor(triviaMonitor: TriviaMonitor): void {
    this.triviaMonitor = triviaMonitor;
  }

  async start(): Promise<void> {
    if (this.intervalId) {
      return;
    }

    const appConfig = await loadAppConfig();
    const interval = appConfig.pollIntervals.message;

    this.intervalId = setInterval(() => {
      this.poll().catch((err) => {
        logger.error(`Message loop poll error: ${err}`);
      });
    }, interval);

    logger.debug(`Message loop started (interval: ${interval}ms)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("Message loop stopped");
    }
  }

  /** Force an immediate poll (POST /test/tick). No-ops if a poll is in flight. */
  async tickNow(): Promise<void> {
    await this.poll();
  }

  private async poll(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;

    try {
      const groups = this.channelManager.getAllGroups();

      for (const group of groups) {
        try {
          await this.pollGroup(group);
        } catch (err) {
          logError(`Error polling group ${group.name}`, err);
        }
      }
    } finally {
      this.polling = false;
    }
  }

  private async pollGroup(group: GroupDocument): Promise<void> {
    // Skip if group already has an active agent
    const groupId = group._id.toString();
    if (this.groupQueue.isGroupActive(groupId)) {
      return;
    }

    // Find unprocessed, non-bot messages for this group
    let unprocessedMessages: MessageDocument[] = await Message.find({
      groupId: group._id,
      processedAt: {$exists: false},
      isFromBot: false,
    }).sort({created: 1});

    if (unprocessedMessages.length === 0) {
      return;
    }

    unprocessedMessages = await this.applyImessageReplyAllowlist(group, unprocessedMessages);
    if (unprocessedMessages.length === 0) {
      return;
    }

    // Check for !trivia commands before normal trigger processing
    if (this.triviaMonitor) {
      for (const msg of unprocessedMessages) {
        if (msg.content.startsWith("!trivia ")) {
          const handled = await this.triviaMonitor.handleChatMessage(
            msg.content,
            msg.senderExternalId || "",
            groupId
          );
          if (handled) {
            await Message.findByIdAndUpdate(msg._id, {$set: {processedAt: new Date()}});
          }
        }
      }
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

  /**
   * iMessage/SMS reply gate: only senders on AppConfig.imessage.replyAllowlist
   * can trigger a reply. Everyone else's messages are catalogued — they stay
   * stored (and appear as context in later conversations) but are marked
   * processed here so they never reach the agent. Non-iMessage channels pass
   * through untouched.
   */
  private async applyImessageReplyAllowlist(
    group: GroupDocument,
    messages: MessageDocument[]
  ): Promise<MessageDocument[]> {
    const channelType = await this.getChannelType(group.channelId.toString());
    if (channelType !== "imessage") {
      return messages;
    }

    const {replyAllowlist} = (await loadAppConfig()).imessage;
    const catalogOnly = messages.filter(
      (msg) => !isHandleAllowed(msg.senderExternalId || msg.sender, replyAllowlist)
    );

    if (catalogOnly.length === 0) {
      return messages;
    }

    await Message.updateMany(
      {_id: {$in: catalogOnly.map((msg) => msg._id)}},
      {$set: {processedAt: new Date()}}
    );
    logger.info(
      `Catalogued ${catalogOnly.length} iMessage message(s) in group ${group.name} from ` +
        `non-allowlisted sender(s) ${[...new Set(catalogOnly.map((msg) => msg.sender))].join(", ")} — no reply`
    );

    return messages.filter((msg) =>
      isHandleAllowed(msg.senderExternalId || msg.sender, replyAllowlist)
    );
  }

  private async getChannelType(channelId: string): Promise<string | undefined> {
    const cached = this.channelTypeCache.get(channelId);
    if (cached) {
      return cached;
    }

    const channel = await Channel.findOneOrNone({_id: channelId});
    if (!channel) {
      return undefined;
    }

    this.channelTypeCache.set(channelId, channel.type);
    return channel.type;
  }
}
