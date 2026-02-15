import type mongoose from "mongoose";
import type { DefaultDoc, DefaultModel, DefaultStatics } from "./userTypes";

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
}

export type MessageDocument = DefaultDoc & MessageFields;
export type MessageStatics = DefaultStatics<MessageDocument>;
export type MessageModel = DefaultModel<MessageDocument> & MessageStatics;
export type MessageSchema = mongoose.Schema<MessageDocument, MessageModel>;
