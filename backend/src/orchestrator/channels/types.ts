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

export interface ChannelHealth {
  name: string;
  type: string;
  /** Coarse connection flag (set on connect, cleared on disconnect). */
  connected: boolean;
  /** True when the underlying transport is verifiably live right now. */
  healthy: boolean;
  /** Transport-specific state, e.g. Slack socket-mode state ("connected", "reconnecting"). */
  state?: string;
  /** Seconds since the transport last reached a connected state. */
  secondsSinceConnected?: number;
  /** Seconds since the last inbound event from the server. */
  secondsSinceEvent?: number;
  /** Human-readable reason when healthy is false. */
  detail?: string;
}

export interface ChannelConnector {
  readonly channelDoc: ChannelDocument;
  /** Whether this channel can render structured cards (Slack only at v1). */
  readonly supportsRichMessages: boolean;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  /** Optional richer liveness for watchdogs; connectors without it report only isConnected(). */
  getHealth?(): ChannelHealth;

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
