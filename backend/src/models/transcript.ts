import mongoose from "mongoose";
import type {TranscriptDocument, TranscriptModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const transcriptSchema = new mongoose.Schema<TranscriptDocument, TranscriptModel>(
  {
    radioStreamId: {type: mongoose.Schema.Types.ObjectId, ref: "RadioStream", required: true},
    targetGroupId: {type: mongoose.Schema.Types.ObjectId, ref: "Group"},
    content: {type: String, required: true},
    durationMs: {type: Number},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

transcriptSchema.index({radioStreamId: 1, created: -1});

addDefaultPlugins(transcriptSchema);

export const Transcript = mongoose.model<TranscriptDocument, TranscriptModel>(
  "Transcript",
  transcriptSchema
);
