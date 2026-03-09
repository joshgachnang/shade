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

  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }
}

export const createSlackConnector: ConnectorFactory = (channelDoc) => {
  return new SlackChannelConnector(channelDoc);
};
