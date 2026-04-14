import mongoose from "mongoose";
import type {PrWatchDocument, PrWatchModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const reviewSchema = new mongoose.Schema(
  {
    reviewer: {type: String, required: true},
    state: {
      type: String,
      required: true,
      enum: ["pending", "approved", "changes_requested", "commented", "dismissed"],
    },
    isBot: {type: Boolean, default: false},
    body: {type: String, default: ""},
    submittedAt: {type: Date, required: true},
    respondedAt: {type: Date},
    responseBody: {type: String},
  },
  {_id: false}
);

const checkRunSchema = new mongoose.Schema(
  {
    name: {type: String, required: true},
    status: {type: String, required: true, enum: ["queued", "in_progress", "completed"]},
    conclusion: {type: String, default: null},
    detailsUrl: {type: String, default: ""},
  },
  {_id: false}
);

const prWatchSchema = new mongoose.Schema<PrWatchDocument, PrWatchModel>(
  {
    repo: {type: String, required: true},
    prNumber: {type: Number, required: true},
    title: {type: String, required: true},
    url: {type: String, required: true},
    branch: {type: String, required: true},
    baseBranch: {type: String, required: true},

    status: {type: String, default: "open", enum: ["open", "merged", "closed"]},
    isDraft: {type: Boolean, default: false},
    hasConflicts: {type: Boolean, default: false},
    mergeable: {type: Boolean, default: null},

    checks: {type: [checkRunSchema], default: []},
    ciPassing: {type: Boolean, default: null},

    reviews: {type: [reviewSchema], default: []},
    reviewDecision: {
      type: String,
      default: null,
      enum: ["approved", "changes_requested", "review_required", null],
    },
    unrepliedHumanComments: {type: Number, default: 0},

    slackMessageTs: {type: String, default: null},
    slackGroupId: {type: String, default: ""},

    autoFixStatus: {
      type: String,
      default: "none",
      enum: ["none", "in_progress", "succeeded", "failed"],
    },
    autoFixType: {type: String, default: null},
    lastAutoFixAttempt: {type: Date, default: null},

    lastPolledAt: {type: Date, default: null},
    lastChangedAt: {type: Date, default: null},
    etag: {type: String, default: null},

    watchedSince: {type: Date, default: () => new Date()},
    unwatchedAt: {type: Date, default: null},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

prWatchSchema.index({repo: 1, prNumber: 1}, {unique: true});
prWatchSchema.index({status: 1, unwatchedAt: 1});

addDefaultPlugins(prWatchSchema);

export const PrWatch = mongoose.model<PrWatchDocument, PrWatchModel>("PrWatch", prWatchSchema);
