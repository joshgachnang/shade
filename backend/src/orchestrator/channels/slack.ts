import {App} from "@slack/bolt";
import type {GenericMessageEvent} from "@slack/types";
import {logger} from "@terreno/api";
import {Channel} from "../../models/channel";
import type {ChannelDocument} from "../../types";
import {logError} from "../errors";
import type {ChannelConnector, ConnectorFactory, InboundMessage} from "./types";

export class SlackChannelConnector implements ChannelConnector {
  readonly channelDoc: ChannelDocument;
  private app: App | null = null;
  private connected = false;
  private messageHandler: ((message: InboundMessage) => Promise<void>) | null = null;

  constructor(channelDoc: ChannelDocument) {
    this.channelDoc = channelDoc;
  }

  private isUserAllowed(userId: string): boolean {
    const config = this.channelDoc.config as {allowedUserIds?: string[]};
    if (!config.allowedUserIds || config.allowedUserIds.length === 0) {
      return true;
    }
    return config.allowedUserIds.includes(userId);
  }

  async connect(): Promise<void> {
    const config = this.channelDoc.config as {
      botToken?: string;
      appToken?: string;
      signingSecret?: string;
    };

    if (!config.botToken || !config.appToken) {
      throw new Error("Slack channel requires botToken and appToken in config");
    }

    logger.info(`Connecting Slack channel "${this.channelDoc.name}"...`);

    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      signingSecret: config.signingSecret,
      socketMode: true,
    });

    this.app.use(async ({body, next}) => {
      const eventType = "event" in body ? (body.event as {type?: string})?.type : undefined;
      logger.debug(`Slack event received: ${eventType ?? body.type ?? "unknown"}`);
      await next();
    });

    this.app.message(async ({message}) => {
      try {
        const msg = message as GenericMessageEvent;
        logger.debug(
          `Slack message in "${this.channelDoc.name}": subtype=${msg.subtype} bot_id=${msg.bot_id} channel=${msg.channel} text="${msg.text?.substring(0, 80)}"`
        );
        if (msg.subtype || msg.bot_id) {
          return;
        }

        if (!this.isUserAllowed(msg.user || "")) {
          logger.debug(
            `Slack message in "${this.channelDoc.name}" from non-allowed user ${msg.user}, skipping`
          );
          return;
        }

        if (!this.messageHandler) {
          logger.debug("No message handler registered, skipping Slack message");
          return;
        }

        await this.messageHandler({
          externalId: msg.ts,
          sender: msg.user || "unknown",
          senderExternalId: msg.user || "",
          content: msg.text || "",
          groupExternalId: msg.channel,
          metadata: {
            threadTs: msg.thread_ts,
            ts: msg.ts,
          },
        });
      } catch (err) {
        logError(`Error handling Slack message in "${this.channelDoc.name}"`, err);
      }
    });

    this.app.event("app_mention", async ({event}) => {
      try {
        logger.debug(
          `Slack app_mention in "${this.channelDoc.name}": channel=${event.channel} user=${event.user} text="${event.text?.substring(0, 80)}"`
        );

        if (!this.isUserAllowed(event.user || "")) {
          logger.debug(
            `Slack mention in "${this.channelDoc.name}" from non-allowed user ${event.user}, skipping`
          );
          return;
        }

        if (!this.messageHandler) {
          logger.debug("No message handler registered, skipping Slack mention");
          return;
        }

        await this.messageHandler({
          externalId: event.ts,
          sender: event.user || "unknown",
          senderExternalId: event.user || "",
          content: event.text || "",
          groupExternalId: event.channel,
          metadata: {
            threadTs: event.thread_ts,
            ts: event.ts,
            isMention: true,
          },
        });
      } catch (err) {
        logError(`Error handling Slack mention in "${this.channelDoc.name}"`, err);
      }
    });

    // Handle Slack errors at the app level
    this.app.error(async (error) => {
      logger.error(`Slack app error in "${this.channelDoc.name}": ${error.message ?? error}`);
    });

    await this.app.start();
    this.connected = true;
    logger.info(`Slack channel "${this.channelDoc.name}" socket connected`);

    try {
      await this.app.client.users.setPresence({
        token: config.botToken,
        presence: "auto",
      });
      logger.debug(`Slack presence set to auto for "${this.channelDoc.name}"`);
    } catch (err) {
      logger.warn(`Could not set presence for "${this.channelDoc.name}": ${err}`);
    }

    try {
      await Channel.findByIdAndUpdate(this.channelDoc._id, {
        $set: {status: "connected", lastConnectedAt: new Date()},
      });
    } catch (err) {
      logger.error(`Failed to update channel status in DB: ${err}`);
    }

    logger.info(`Slack channel "${this.channelDoc.name}" fully connected`);
  }

  async disconnect(): Promise<void> {
    logger.info(`Disconnecting Slack channel "${this.channelDoc.name}"...`);
    if (this.app) {
      try {
        await this.app.stop();
      } catch (err) {
        logger.error(`Error stopping Slack app for "${this.channelDoc.name}": ${err}`);
      }
      this.app = null;
    }
    this.connected = false;

    try {
      await Channel.findByIdAndUpdate(this.channelDoc._id, {
        $set: {status: "disconnected"},
      });
    } catch (err) {
      logger.error(`Failed to update channel status in DB: ${err}`);
    }

    logger.info(`Slack channel "${this.channelDoc.name}" disconnected`);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendMessage(groupExternalId: string, content: string): Promise<void> {
    if (!this.app) {
      logger.error(
        `Cannot send message to ${groupExternalId} — Slack channel "${this.channelDoc.name}" not connected`
      );
      throw new Error("Slack channel not connected");
    }

    const config = this.channelDoc.config as {botToken?: string};
    if (!config.botToken) {
      throw new Error("No bot token configured");
    }

    logger.debug(
      `Sending message to ${groupExternalId} via "${this.channelDoc.name}" (${content.length} chars)`
    );

    await this.app.client.chat.postMessage({
      token: config.botToken,
      channel: groupExternalId,
      text: content,
    });

    logger.debug(`Message sent to ${groupExternalId} via "${this.channelDoc.name}"`);
  }

  async sendMessageWithTs(groupExternalId: string, content: string): Promise<string> {
    if (!this.app) {
      throw new Error("Slack channel not connected");
    }

    const config = this.channelDoc.config as {botToken?: string};
    if (!config.botToken) {
      throw new Error("No bot token configured");
    }

    const result = await this.app.client.chat.postMessage({
      token: config.botToken,
      channel: groupExternalId,
      text: content,
    });

    return result.ts || "";
  }

  async updateMessage(groupExternalId: string, messageTs: string, content: string): Promise<void> {
    if (!this.app) {
      return;
    }

    const config = this.channelDoc.config as {botToken?: string};
    try {
      await this.app.client.chat.update({
        token: config.botToken,
        channel: groupExternalId,
        ts: messageTs,
        text: content,
      });
    } catch (err) {
      logger.debug(`Could not update message: ${err}`);
    }
  }

  async createChannel(name: string): Promise<{id: string}> {
    if (!this.app) {
      throw new Error("Slack channel not connected");
    }
    const config = this.channelDoc.config as {botToken?: string};
    const result = await this.app.client.conversations.create({
      token: config.botToken,
      name,
      is_private: false,
    });
    if (!result.channel?.id) {
      throw new Error("Failed to create Slack channel — no channel ID returned");
    }
    return {id: result.channel.id};
  }

  async inviteToChannel(channelId: string, userId: string): Promise<void> {
    if (!this.app) {
      throw new Error("Slack channel not connected");
    }
    const config = this.channelDoc.config as {botToken?: string};
    await this.app.client.conversations.invite({
      token: config.botToken,
      channel: channelId,
      users: userId,
    });
  }

  async addReaction(groupExternalId: string, messageTs: string, emoji: string): Promise<void> {
    if (!this.app) {
      return;
    }
    const config = this.channelDoc.config as {botToken?: string};
    try {
      await this.app.client.reactions.add({
        token: config.botToken,
        channel: groupExternalId,
        timestamp: messageTs,
        name: emoji,
      });
    } catch (err) {
      logger.debug(`Could not add reaction: ${err}`);
    }
  }

  async removeReaction(groupExternalId: string, messageTs: string, emoji: string): Promise<void> {
    if (!this.app) {
      return;
    }
    const config = this.channelDoc.config as {botToken?: string};
    try {
      await this.app.client.reactions.remove({
        token: config.botToken,
        channel: groupExternalId,
        timestamp: messageTs,
        name: emoji,
      });
    } catch (err) {
      logger.debug(`Could not remove reaction: ${err}`);
    }
  }

  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }
}

export const createSlackConnector: ConnectorFactory = (channelDoc) => {
  return new SlackChannelConnector(channelDoc);
};
