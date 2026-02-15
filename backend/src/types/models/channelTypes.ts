import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface ChannelFields {
  name: string;
  type: "slack" | "webhook";
  status: "connected" | "disconnected" | "error";
  config: Record<string, unknown>;
  lastConnectedAt?: Date;
}

export type ChannelDocument = DefaultDoc & ChannelFields;
export type ChannelStatics = DefaultStatics<ChannelDocument>;
export type ChannelModel = DefaultModel<ChannelDocument> & ChannelStatics;
export type ChannelSchema = mongoose.Schema<ChannelDocument, ChannelModel>;
