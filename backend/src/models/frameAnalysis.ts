import mongoose from "mongoose";
import type {FrameAnalysisDocument, FrameAnalysisModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const frameAnalysisSchema = new mongoose.Schema<FrameAnalysisDocument, FrameAnalysisModel>(
  {
    frameId: {type: mongoose.Schema.Types.ObjectId, ref: "Frame", required: true, index: true},
    movieId: {type: mongoose.Schema.Types.ObjectId, ref: "Movie", required: true, index: true},
    timestamp: {type: Number, required: true},
    sceneDescription: {type: String, default: ""},
    objects: [
      {
        label: {type: String, required: true},
        confidence: {type: Number, required: true},
      },
    ],
    characters: [
      {
        name: {type: String, required: true},
        description: {type: String, default: ""},
        confidence: {type: Number, required: true},
      },
    ],
    text: [
      {
        content: {type: String, required: true},
        context: {type: String, default: ""},
      },
    ],
    tags: {type: [String], default: []},
    mood: {type: String, default: ""},
    rawResponse: {type: String, default: ""},
    modelUsed: {type: String, default: ""},
    tokensUsed: {type: Number, default: 0},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

frameAnalysisSchema.index({movieId: 1, timestamp: 1});

addDefaultPlugins(frameAnalysisSchema);

export const FrameAnalysis = mongoose.model<FrameAnalysisDocument, FrameAnalysisModel>(
  "FrameAnalysis",
  frameAnalysisSchema
);
