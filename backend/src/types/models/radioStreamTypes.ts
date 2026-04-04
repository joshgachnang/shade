import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface DeepgramConfig {
  model?: string;
  language?: string;
  smartFormat?: boolean;
  punctuate?: boolean;
  confidenceThreshold?: number;
}

export interface RadioStreamFields {
  name: string;
  streamUrl: string;
  targetGroupId?: mongoose.Types.ObjectId;
  slackWebhookUrl?: string;
  slackBotToken?: string;
  slackChannelId?: string;
  status: "active" | "paused" | "stopped" | "error";
  deepgramConfig: DeepgramConfig;
  transcriptionEnabled: boolean;
  transcriptBatchIntervalMs: number;
  lastTranscriptAt?: Date;
  errorMessage?: string;
  reconnectCount: number;
}

export type RadioStreamDocument = DefaultDoc & RadioStreamFields;
export type RadioStreamStatics = DefaultStatics<RadioStreamDocument>;
export type RadioStreamModel = DefaultModel<RadioStreamDocument> & RadioStreamStatics;
export type RadioStreamSchema = mongoose.Schema<RadioStreamDocument, RadioStreamModel>;
