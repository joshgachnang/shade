import {logger} from "@terreno/api";
import {CHANNEL_STATUS, type ChannelStatus} from "../../constants/statuses";
import {Channel} from "../../models/channel";
import type {ChannelDocument} from "../../types";
import type {ChannelConnector, InboundMessage} from "./types";

/**
 * Shared behavior for every ChannelConnector: connection state tracking,
 * inbound-message handler registration/dispatch, and persisting status to the
 * Channel model. Concrete connectors (Slack, iMessage, Email, Webhook) extend
 * this and implement transport-specific connect/disconnect/send logic.
 */
export abstract class BaseChannelConnector implements ChannelConnector {
  readonly channelDoc: ChannelDocument;
  protected connected = false;
  protected messageHandler: ((message: InboundMessage) => Promise<void>) | null = null;

  constructor(channelDoc: ChannelDocument) {
    this.channelDoc = channelDoc;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract sendMessage(groupExternalId: string, content: string): Promise<void>;
  abstract sendMessageWithTs(groupExternalId: string, content: string): Promise<string>;
  abstract updateMessage(
    groupExternalId: string,
    messageTs: string,
    content: string
  ): Promise<void>;
  abstract addReaction(groupExternalId: string, messageTs: string, emoji: string): Promise<void>;
  abstract removeReaction(groupExternalId: string, messageTs: string, emoji: string): Promise<void>;
  abstract createChannel(name: string): Promise<{id: string}>;
  abstract inviteToChannel(channelId: string, userId: string): Promise<void>;

  isConnected(): boolean {
    return this.connected;
  }

  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  /**
   * Persist the channel's connection status to the Channel model. Failures are
   * logged but swallowed so a DB hiccup can't break the underlying connection.
   */
  protected async persistStatus(status: ChannelStatus): Promise<void> {
    const update: Record<string, unknown> = {status};
    if (status === CHANNEL_STATUS.connected) {
      update.lastConnectedAt = new Date();
    }
    try {
      await Channel.findByIdAndUpdate(this.channelDoc._id, {$set: update});
    } catch (err) {
      logger.error(
        `Failed to update ${this.channelDoc.type} channel "${this.channelDoc.name}" status in DB: ${err}`
      );
    }
  }

  /**
   * Dispatch an inbound message to the registered handler. Returns true if a
   * handler was available. Callers can bail early when false to avoid wasted
   * work.
   */
  protected async dispatchMessage(message: InboundMessage): Promise<boolean> {
    if (!this.messageHandler) {
      logger.debug(
        `No message handler registered for ${this.channelDoc.type} channel "${this.channelDoc.name}", skipping message`
      );
      return false;
    }
    await this.messageHandler(message);
    return true;
  }
}
