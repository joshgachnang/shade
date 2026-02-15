import mongoose from "mongoose";
import type {WebhookSourceDocument, WebhookSourceModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const webhookSourceSchema = new mongoose.Schema<WebhookSourceDocument, WebhookSourceModel>(
  {
    name: {type: String, required: true, trim: true},
    type: {type: String, required: true, enum: ["webhook", "websocket"]},
    groupId: {type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true},
    endpoint: {type: String},
    secret: {type: String},
    classification: {
      type: String,
      default: "internal",
      enum: ["public", "internal", "sensitive", "critical"],
    },
    enabled: {type: Boolean, default: true},
    lastReceivedAt: {type: Date},
    config: {type: mongoose.Schema.Types.Mixed, default: {}},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

addDefaultPlugins(webhookSourceSchema);

export const WebhookSource = mongoose.model<WebhookSourceDocument, WebhookSourceModel>(
  "WebhookSource",
  webhookSourceSchema
);
