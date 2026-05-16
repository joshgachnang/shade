import crypto from "node:crypto";
import {logger} from "@terreno/api";
import {EdgeAgent} from "../../models/edgeAgent";
import type {ChannelDocument} from "../../types";
import type {ChannelConnector, ConnectorFactory, InboundMessage} from "./types";

export class EdgeAgentChannelConnector implements ChannelConnector {
  readonly channelDoc: ChannelDocument;
  readonly supportsRichMessages = false;
  private connected = false;

  constructor(channelDoc: ChannelDocument) {
    this.channelDoc = channelDoc;
  }

  async connect(): Promise<void> {
    // No-op: edge agents manage their own connections
    this.connected = true;
    logger.info(`EdgeAgent channel connector ready for "${this.channelDoc.name}"`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendMessage(groupExternalId: string, content: string): Promise<void> {
    // Find the edge agent linked to this channel
    const agent = await EdgeAgent.findOne({channelId: this.channelDoc._id});
    if (!agent) {
      logger.error(`No edge agent linked to channel ${this.channelDoc._id}`);
      return;
    }

    const commandId = crypto.randomUUID();
    await EdgeAgent.findByIdAndUpdate(agent._id, {
      $push: {
        pendingCommands: {
          commandId,
          type: "send_message",
          payload: {to: groupExternalId, text: content},
          queuedAt: new Date(),
        },
      },
    });

    logger.debug(`Queued send_message command ${commandId} for edge agent "${agent.name}"`);
  }

  async sendMessageWithTs(_groupExternalId: string, _content: string): Promise<string> {
    return "";
  }

  async updateMessage(
    _groupExternalId: string,
    _messageTs: string,
    _content: string
  ): Promise<void> {}

  async addReaction(_groupExternalId: string, _messageTs: string, _emoji: string): Promise<void> {}

  async removeReaction(
    _groupExternalId: string,
    _messageTs: string,
    _emoji: string
  ): Promise<void> {}

  async createChannel(_name: string): Promise<{id: string}> {
    throw new Error("Edge agent channels do not support channel creation");
  }

  async inviteToChannel(_channelId: string, _userId: string): Promise<void> {
    throw new Error("Edge agent channels do not support channel invitations");
  }

  onMessage(_handler: (message: InboundMessage) => Promise<void>): void {
    // No-op: inbound messages come via the data push endpoint, not the connector
  }
}

export const createEdgeAgentConnector: ConnectorFactory = (channelDoc) => {
  return new EdgeAgentChannelConnector(channelDoc);
};
