import mongoose from "mongoose";
import type {FeatureDocument, FeatureModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const featureStepSchema = new mongoose.Schema(
  {
    name: {type: String, required: true, trim: true},
    description: {type: String, trim: true},
    order: {type: Number, required: true},
    status: {
      type: String,
      default: "pending",
      enum: ["pending", "in_progress", "complete", "error", "skipped"],
    },
    startedAt: {type: Date},
    completedAt: {type: Date},
    result: {type: String},
    errorMessage: {type: String},
  },
  {_id: true}
);

const featureSchema = new mongoose.Schema<FeatureDocument, FeatureModel>(
  {
    name: {type: String, required: true, trim: true},
    description: {type: String, trim: true},
    groupId: {type: mongoose.Schema.Types.ObjectId, ref: "Group"},
    status: {
      type: String,
      default: "planned",
      enum: ["planned", "in_progress", "paused", "complete", "error"],
    },
    steps: {type: [featureStepSchema], default: []},
    currentStepIndex: {type: Number, default: 0},
    startedAt: {type: Date},
    completedAt: {type: Date},
    errorMessage: {type: String},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

featureSchema.index({status: 1});
featureSchema.index({groupId: 1});

addDefaultPlugins(featureSchema);

export const Feature = mongoose.model<FeatureDocument, FeatureModel>("Feature", featureSchema);
