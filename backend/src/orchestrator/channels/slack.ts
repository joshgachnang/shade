import {App} from "@slack/bolt";
import type {GenericMessageEvent} from "@slack/types";
import {logger} from "@terreno/api";
import {Channel} from "../../models/channel";
import type {ChannelDocument} from "../../types";
import type {ChannelConnector, InboundMessage} from "./types";

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

    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      signingSecret: config.signingSecret,
      socketMode: true,
    });

    this.app.message(async ({message}) => {
      const msg = message as GenericMessageEvent;
      if (msg.subtype || msg.bot_id) {
        return;
      }

      if (!this.messageHandler) {
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
    });

    this.app.event("app_mention", async ({event}) => {
      if (!this.messageHandler) {
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
    });

    await this.app.start();
    this.connected = true;

    await Channel.findByIdAndUpdate(this.channelDoc._id, {
      $set: {status: "connected", lastConnectedAt: new Date()},
    });

    logger.info(`Slack channel "${this.channelDoc.name}" connected`);
  }

  async disconnect(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
    this.connected = false;

    await Channel.findByIdAndUpdate(this.channelDoc._id, {
      $set: {status: "disconnected"},
    });

    logger.info(`Slack channel "${this.channelDoc.name}" disconnected`);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendMessage(groupExternalId: string, content: string): Promise<void> {
    if (!this.app) {
      throw new Error("Slack channel not connected");
    }

    const config = this.channelDoc.config as {botToken?: string};
    if (!config.botToken) {
      throw new Error("No bot token configured");
    }

    await this.app.client.chat.postMessage({
      token: config.botToken,
      channel: groupExternalId,
      text: content,
    });
  }

  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }
}
