import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface WebhookSourceFields {
  name: string;
  type: "webhook" | "websocket";
  groupId: mongoose.Types.ObjectId;
  endpoint?: string;
  secret?: string;
  classification: "public" | "internal" | "sensitive" | "critical";
  enabled: boolean;
  lastReceivedAt?: Date;
  config: Record<string, unknown>;
}

export type WebhookSourceDocument = DefaultDoc & WebhookSourceFields;
export type WebhookSourceStatics = DefaultStatics<WebhookSourceDocument>;
export type WebhookSourceModel = DefaultModel<WebhookSourceDocument> & WebhookSourceStatics;
export type WebhookSourceSchema = mongoose.Schema<WebhookSourceDocument, WebhookSourceModel>;
