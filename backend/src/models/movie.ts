import mongoose from "mongoose";
import type {MovieDocument, MovieModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const movieSchema = new mongoose.Schema<MovieDocument, MovieModel>(
  {
    title: {type: String, required: true, trim: true},
    filePath: {type: String, required: true},
    duration: {type: Number, default: 0},
    fps: {type: Number, default: 0},
    resolution: {
      width: {type: Number, default: 0},
      height: {type: Number, default: 0},
    },
    frameCount: {type: Number, default: 0},
    processedFrameCount: {type: Number, default: 0},
    status: {
      type: String,
      default: "pending",
      enum: ["pending", "extracting", "analyzing", "complete", "error"],
    },
    errorMessage: {type: String},
    actors: {type: [String], default: []},
    extractionConfig: {
      mode: {type: String, default: "scene-change", enum: ["scene-change", "interval", "every-frame"]},
      intervalSeconds: {type: Number},
      sceneThreshold: {type: Number, default: 0.3},
    },
    openRouterModel: {type: String, default: "google/gemini-2.0-flash-001"},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

addDefaultPlugins(movieSchema);

export const Movie = mongoose.model<MovieDocument, MovieModel>("Movie", movieSchema);
