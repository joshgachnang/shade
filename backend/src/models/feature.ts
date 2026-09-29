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

const breweryWorkspaceSchema = new mongoose.Schema(
  {
    kind: {type: String, required: true, enum: ["zerg", "local"]},
    session: {
      type: String,
      required(this: {kind: string}) {
        return this.kind === "zerg";
      },
    },
    repoPath: {
      type: String,
      required(this: {kind: string}) {
        return this.kind === "local";
      },
    },
  },
  {_id: false, strict: "throw"}
);

const breweryWaitingSchema = new mongoose.Schema(
  {
    kind: {type: String, required: true, enum: ["signoff", "gate"]},
    since: {type: Date, required: true},
  },
  {_id: false, strict: "throw"}
);

const breweryStepMessageSchema = new mongoose.Schema(
  {
    seq: {type: Number, required: true},
    ts: {type: String, required: true},
    label: {type: String},
    lines: {type: [String], default: []},
    dirty: {type: Boolean, default: false},
    flushedAt: {type: Date},
    final: {type: String},
  },
  {_id: false, strict: "throw"}
);

const brewerySchema = new mongoose.Schema(
  {
    slug: {type: String, required: true},
    repo: {type: String, required: true},
    workspace: {type: breweryWorkspaceSchema, required: true},
    phase: {type: String},
    waiting: {type: breweryWaitingSchema},
    eventsOffset: {type: Number, required: true, min: 0, default: 0},
    stepMessages: {type: [breweryStepMessageSchema], default: []},
    pr: {type: Number},
    lastEventAt: {type: Date},
    pollLeaseUntil: {type: Date},
  },
  {_id: false, strict: "throw"}
);

const featureSchema = new mongoose.Schema<FeatureDocument, FeatureModel>(
  {
    name: {type: String, required: true, trim: true},
    description: {type: String, trim: true},
    groupId: {type: mongoose.Schema.Types.ObjectId, ref: "Group"},
    status: {
      type: String,
      default: "planned",
      enum: ["planned", "in_progress", "awaiting_approval", "paused", "complete", "error"],
    },
    brewery: {type: brewerySchema},
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
