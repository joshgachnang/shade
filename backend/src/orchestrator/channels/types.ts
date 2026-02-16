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

  onMessage(handler: (message: InboundMessage) => Promise<void>): void;
}
