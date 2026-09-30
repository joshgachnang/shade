import {logger} from "@terreno/api";
import {nanoid} from "nanoid";
import {Group} from "../../models/group";
import {Message} from "../../models/message";
import type {ChannelDocument} from "../../types";
import type {ChannelConnector, ChannelHealth, ConnectorFactory, InboundMessage} from "./types";

/**
 * Offline transport for the AI testability harness (IP-012).
 * Direct sends persist bot Message records for GET /test/outbox. ChannelManager's
 * group-send paths persist their enriched records themselves without this send.
 * Inbound messages are injected via POST /command.
 */
class TestChannelConnector implements ChannelConnector {
  readonly channelDoc: ChannelDocument;
  readonly supportsRichMessages = false;
  private connected = false;
  private connectedAt: number | null = null;
  private messageCounter = 0;

  constructor(channelDoc: ChannelDocument) {
    this.channelDoc = channelDoc;
  }

  async connect(): Promise<void> {
    this.connected = true;
    this.connectedAt = Date.now();
    logger.info(`Test channel "${this.channelDoc.name}" connected (no-op transport)`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getHealth(): ChannelHealth {
    return {
      name: this.channelDoc.name,
      type: this.channelDoc.type,
      connected: this.connected,
      healthy: this.connected,
      state: this.connected ? "connected" : "disconnected",
      secondsSinceConnected: this.connectedAt
        ? Math.floor((Date.now() - this.connectedAt) / 1000)
        : undefined,
    };
  }

  async sendMessage(groupExternalId: string, content: string): Promise<void> {
    const group = await Group.findExactlyOne({
      channelId: this.channelDoc._id,
      externalId: groupExternalId,
    });
    await Message.create({
      groupId: group._id,
      channelId: this.channelDoc._id,
      sender: "Shade",
      content,
      isFromBot: true,
      processedAt: new Date(),
      correlationId: nanoid(12),
    });
  }

  async sendMessageWithTs(groupExternalId: string, content: string): Promise<string> {
    await this.sendMessage(groupExternalId, content);
    return `test-ts-${++this.messageCounter}`;
  }

  async updateMessage(
    _groupExternalId: string,
    messageTs: string,
    _content: string
  ): Promise<void> {
    logger.debug(`Test channel updateMessage ${messageTs} (no-op)`);
  }

  async addReaction(_groupExternalId: string, messageTs: string, emoji: string): Promise<void> {
    logger.debug(`Test channel addReaction ${emoji} on ${messageTs} (no-op)`);
  }

  async removeReaction(_groupExternalId: string, messageTs: string, emoji: string): Promise<void> {
    logger.debug(`Test channel removeReaction ${emoji} on ${messageTs} (no-op)`);
  }

  async createChannel(name: string): Promise<{id: string}> {
    return {id: `test-channel-${name}`};
  }

  async inviteToChannel(_channelId: string, _userId: string): Promise<void> {}

  async archiveChannel(channelId: string): Promise<void> {
    logger.debug(`Test channel archiveChannel ${channelId} (no-op)`);
  }

  onMessage(_handler: (message: InboundMessage) => Promise<void>): void {
    // Inbound arrives via POST /command, which writes Message docs directly.
  }
}

export const createTestConnector: ConnectorFactory = (channelDoc) => {
  return new TestChannelConnector(channelDoc);
};
