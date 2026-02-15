import mongoose from "mongoose";
import type { MessageDocument, MessageModel } from "../types";
import { addDefaultPlugins } from "./modelPlugins";

const messageSchema = new mongoose.Schema<MessageDocument, MessageModel>(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: "Channel", required: true },
    externalId: { type: String },
    sender: { type: String, required: true },
    senderExternalId: { type: String },
    content: { type: String, required: true },
    isFromBot: { type: Boolean, default: false },
    processedAt: { type: Date },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { strict: "throw", toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

messageSchema.index({ groupId: 1, created: 1 });
messageSchema.index({ groupId: 1, processedAt: 1 });

addDefaultPlugins(messageSchema);

export const Message = mongoose.model<MessageDocument, MessageModel>("Message", messageSchema);
