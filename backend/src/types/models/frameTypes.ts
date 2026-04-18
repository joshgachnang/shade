import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface FrameFields {
  movieId: mongoose.Types.ObjectId;
  frameNumber: number;
  timestamp: number;
  imagePath: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  status: "pending" | "analyzing" | "complete" | "error";
  errorMessage?: string;
}

export type FrameDocument = DefaultDoc & FrameFields;
export type FrameStatics = DefaultStatics<FrameDocument>;
export type FrameModel = DefaultModel<FrameDocument> & FrameStatics;
export type FrameSchema = mongoose.Schema<FrameDocument, FrameModel>;
