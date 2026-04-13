import mongoose from "mongoose";
import type {FrameDocument, FrameModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const frameSchema = new mongoose.Schema<FrameDocument, FrameModel>(
  {
    movieId: {type: mongoose.Schema.Types.ObjectId, ref: "Movie", required: true, index: true},
    frameNumber: {type: Number, required: true},
    timestamp: {type: Number, required: true},
    imagePath: {type: String, required: true},
    width: {type: Number, default: 0},
    height: {type: Number, default: 0},
    fileSizeBytes: {type: Number, default: 0},
    status: {
      type: String,
      default: "pending",
      enum: ["pending", "analyzing", "complete", "error"],
    },
    errorMessage: {type: String},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

frameSchema.index({movieId: 1, frameNumber: 1});

addDefaultPlugins(frameSchema);

export const Frame = mongoose.model<FrameDocument, FrameModel>("Frame", frameSchema);
