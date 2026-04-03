import mongoose from "mongoose";
import type {RadioStreamDocument, RadioStreamModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const radioStreamSchema = new mongoose.Schema<RadioStreamDocument, RadioStreamModel>(
  {
    name: {type: String, required: true, trim: true},
    streamUrl: {type: String, required: true},
    targetGroupId: {type: mongoose.Schema.Types.ObjectId, ref: "Group"},
    slackWebhookUrl: {type: String},
    slackBotToken: {type: String},
    slackChannelId: {type: String},
    status: {
      type: String,
      default: "stopped",
      enum: ["active", "paused", "stopped", "error"],
    },
    deepgramConfig: {
      type: new mongoose.Schema(
        {
          model: {type: String, default: "nova-3"},
          language: {type: String, default: "en"},
          smartFormat: {type: Boolean, default: true},
          punctuate: {type: Boolean, default: true},
          confidenceThreshold: {type: Number, default: 0.7},
        },
        {_id: false}
      ),
      default: {},
    },
    transcriptionEnabled: {type: Boolean, default: false},
    transcriptBatchIntervalMs: {type: Number, default: 15000},
    lastTranscriptAt: {type: Date},
    errorMessage: {type: String},
    reconnectCount: {type: Number, default: 0},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

radioStreamSchema.index({status: 1});

addDefaultPlugins(radioStreamSchema);

export const RadioStream = mongoose.model<RadioStreamDocument, RadioStreamModel>(
  "RadioStream",
  radioStreamSchema
);
