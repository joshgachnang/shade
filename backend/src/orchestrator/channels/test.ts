import {logger} from "@terreno/api";
import type {ChannelDocument} from "../../types";
import type {ChannelConnector, ChannelHealth, ConnectorFactory, InboundMessage} from "./types";

/**
 * No-op transport for the AI testability harness (IP-012).
 *
 * Registered as the `"test"` channel type so a running server can host
 * observable conversations without any external service. Outbound sends
 * terminate here; the observation source of truth is the `Message` doc with
 * `isFromBot: true` that ChannelManager persists after this connector returns
 * (that is what `GET /test/outbox` reads). Inbound messages never come through
 * this connector — they are injected via `POST /command`.
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
    logger.debug(
      `Test channel delivery to ${groupExternalId} (${content.length} chars): ${content.substring(0, 120)}`
    );
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

  onMessage(_handler: (message: InboundMessage) => Promise<void>): void {
    // Inbound arrives via POST /command, which writes Message docs directly.
  }
}

export const createTestConnector: ConnectorFactory = (channelDoc) => {
  return new TestChannelConnector(channelDoc);
};
