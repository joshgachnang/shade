import type {KnownBlock} from "@slack/types";
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

export interface RichSendOpts {
  /** groupId + correlationId are used to substitute action_id placeholders. */
  groupId: string;
  correlationId: string;
  /** Slack thread_ts; ignored by non-Slack connectors. */
  threadTs?: string;
}

export interface ChannelConnector {
  readonly channelDoc: ChannelDocument;
  /** Whether this channel can render structured cards (Slack only at v1). */
  readonly supportsRichMessages: boolean;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  sendMessage(groupExternalId: string, content: string): Promise<void>;
  sendMessageWithTs(groupExternalId: string, content: string): Promise<string>;
  updateMessage(groupExternalId: string, messageTs: string, content: string): Promise<void>;
  addReaction(groupExternalId: string, messageTs: string, emoji: string): Promise<void>;
  removeReaction(groupExternalId: string, messageTs: string, emoji: string): Promise<void>;

  /** Send a pre-rendered rich message. Implemented by connectors with `supportsRichMessages = true`. */
  sendRichMessage?(
    groupExternalId: string,
    rendered: {blocks: KnownBlock[]; text: string},
    opts: RichSendOpts
  ): Promise<void>;

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
