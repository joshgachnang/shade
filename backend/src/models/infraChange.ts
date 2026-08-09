import mongoose from "mongoose";
import type {InfraChangeDocument, InfraChangeModel} from "../types/models/infraChangeTypes";
import {addDefaultPlugins} from "./modelPlugins";

const infraChangeSchema = new mongoose.Schema<InfraChangeDocument, InfraChangeModel>(
  {
    repoName: {type: String, required: true},
    owner: {type: String, required: true},
    repo: {type: String, required: true},
    prNumber: {type: Number, required: true},
    url: {type: String, required: true},
    branch: {type: String, required: true},
    title: {type: String, default: ""},
    groupId: {type: String, default: ""},

    status: {type: String, default: "open", enum: ["open", "merged", "closed"]},
    ciPassing: {type: Boolean, default: null},
    reviewDecision: {
      type: String,
      default: null,
      enum: ["approved", "changes_requested", "review_required", null],
    },
    lastSummary: {type: String, default: ""},

    lastPolledAt: {type: Date, default: null},
    mergedAt: {type: Date, default: null},
    closedAt: {type: Date, default: null},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

infraChangeSchema.index({owner: 1, repo: 1, prNumber: 1}, {unique: true});
infraChangeSchema.index({status: 1});

addDefaultPlugins(infraChangeSchema);

export const InfraChange = mongoose.model<InfraChangeDocument, InfraChangeModel>(
  "InfraChange",
  infraChangeSchema
);
