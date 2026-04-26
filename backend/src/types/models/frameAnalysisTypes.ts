import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface AnalysisObject {
  label: string;
  confidence: number;
}

export interface AnalysisCharacter {
  name: string;
  description: string;
  confidence: number;
}

export interface AnalysisText {
  content: string;
  context: string;
}

export interface FrameAnalysisFields {
  frameId: mongoose.Types.ObjectId;
  movieId: mongoose.Types.ObjectId;
  timestamp: number;
  sceneDescription: string;
  objects: AnalysisObject[];
  characters: AnalysisCharacter[];
  text: AnalysisText[];
  tags: string[];
  mood: string;
  rawResponse: string;
  modelUsed: string;
  tokensUsed: number;
}

export type FrameAnalysisDocument = DefaultDoc & FrameAnalysisFields;
export type FrameAnalysisStatics = DefaultStatics<FrameAnalysisDocument>;
export type FrameAnalysisModel = DefaultModel<FrameAnalysisDocument> & FrameAnalysisStatics;
export type FrameAnalysisSchema = mongoose.Schema<FrameAnalysisDocument, FrameAnalysisModel>;
