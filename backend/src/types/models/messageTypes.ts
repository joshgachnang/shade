import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface MessageActionMetadata {
  actionId: string;
  value?: string;
}

export interface MessageFields {
  groupId: mongoose.Types.ObjectId;
  channelId: mongoose.Types.ObjectId;
  externalId?: string;
  sender: string;
  senderExternalId?: string;
  content: string;
  isFromBot: boolean;
  processedAt?: Date;
  metadata: Record<string, unknown>;
  /** Structured RichResponse JSON; populated when the agent emitted a card response. */
  richPayload?: Record<string, unknown>;
  /** Stable id stamped on every outbound bot Message; used to stitch action round-trips. */
  correlationId?: string;
  /** For inbound action-driven messages: the correlationId of the outbound card that produced the button. */
  parentCorrelationId?: string;
  /** For inbound action-driven messages: which action fired and any opaque value. */
  actionMetadata?: MessageActionMetadata;
}

export type MessageDocument = DefaultDoc & MessageFields;
export type MessageStatics = DefaultStatics<MessageDocument>;
export type MessageModel = DefaultModel<MessageDocument> & MessageStatics;
export type MessageSchema = mongoose.Schema<MessageDocument, MessageModel>;
