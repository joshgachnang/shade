import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface PrWatchReview {
  reviewer: string;
  state: "pending" | "approved" | "changes_requested" | "commented" | "dismissed";
  isBot: boolean;
  body: string;
  submittedAt: Date;
  respondedAt?: Date;
  responseBody?: string;
}

export interface PrWatchCheckRun {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  detailsUrl: string;
}

export interface PrWatchFields {
  repo: string;
  prNumber: number;
  title: string;
  url: string;
  branch: string;
  baseBranch: string;

  status: "open" | "merged" | "closed";
  isDraft: boolean;
  hasConflicts: boolean;
  mergeable: boolean | null;

  checks: PrWatchCheckRun[];
  ciPassing: boolean | null;

  reviews: PrWatchReview[];
  reviewDecision: "approved" | "changes_requested" | "review_required" | null;
  unrepliedHumanComments: number;

  slackMessageTs: string | null;
  slackGroupId: string;

  autoFixStatus: "none" | "in_progress" | "succeeded" | "failed";
  autoFixType: string | null;
  lastAutoFixAttempt: Date | null;

  lastPolledAt: Date | null;
  lastChangedAt: Date | null;
  etag: string | null;

  watchedSince: Date;
  unwatchedAt: Date | null;
}

export type PrWatchDocument = DefaultDoc & PrWatchFields;
export type PrWatchStatics = DefaultStatics<PrWatchDocument>;
export type PrWatchModel = DefaultModel<PrWatchDocument> & PrWatchStatics;
export type PrWatchSchema = mongoose.Schema<PrWatchDocument, PrWatchModel>;
