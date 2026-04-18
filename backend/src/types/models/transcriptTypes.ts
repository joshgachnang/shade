import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface TranscriptFields {
  radioStreamId: mongoose.Types.ObjectId;
  targetGroupId?: mongoose.Types.ObjectId;
  content: string;
  durationMs?: number;
  recordingUrl?: string;
}

export type TranscriptDocument = DefaultDoc & TranscriptFields;
export type TranscriptStatics = DefaultStatics<TranscriptDocument>;
export type TranscriptModel = DefaultModel<TranscriptDocument> & TranscriptStatics;
export type TranscriptSchema = mongoose.Schema<TranscriptDocument, TranscriptModel>;
