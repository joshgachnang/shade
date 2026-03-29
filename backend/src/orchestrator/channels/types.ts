import type express from "express";
import type {ChannelDocument} from "../../types";

export interface InboundMessage {
  externalId: string;
  sender: string;
  senderExternalId: string;
  content: string;
  groupExternalId: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelConnector {
  readonly channelDoc: ChannelDocument;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  sendMessage(groupExternalId: string, content: string): Promise<void>;
  addReaction(groupExternalId: string, messageTs: string, emoji: string): Promise<void>;
  removeReaction(groupExternalId: string, messageTs: string, emoji: string): Promise<void>;

  createChannel(name: string): Promise<{id: string}>;
  inviteToChannel(channelId: string, userId: string): Promise<void>;

  onMessage(handler: (message: InboundMessage) => Promise<void>): void;
}

export interface ConnectorFactoryContext {
  expressApp: express.Application | null;
}

export type ConnectorFactory = (
  channelDoc: ChannelDocument,
  context: ConnectorFactoryContext
) => ChannelConnector;
