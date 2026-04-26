import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface ExtractionConfig {
  mode: "scene-change" | "interval" | "every-frame";
  intervalSeconds?: number;
  sceneThreshold?: number;
}

export interface MovieFields {
  title: string;
  filePath: string;
  duration: number;
  fps: number;
  resolution: {width: number; height: number};
  frameCount: number;
  processedFrameCount: number;
  status: "pending" | "extracting" | "analyzing" | "complete" | "error";
  errorMessage?: string;
  actors: string[];
  extractionConfig: ExtractionConfig;
  openRouterModel: string;
}

export type MovieDocument = DefaultDoc & MovieFields;
export type MovieStatics = DefaultStatics<MovieDocument>;
export type MovieModel = DefaultModel<MovieDocument> & MovieStatics;
export type MovieSchema = mongoose.Schema<MovieDocument, MovieModel>;
