import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

/**
 * One infrastructure change the bot proposed: a pull request on a managed repo,
 * tracked so the InfraWatcher can report its review/CI/merge progress back to
 * the group. Terminal states (merged/closed) stop the watcher following it.
 */
export interface InfraChangeFields {
  /** The repo handle from AppConfig.infraBot.repos. */
  repoName: string;
  owner: string;
  repo: string;
  prNumber: number;
  url: string;
  branch: string;
  title: string;
  /** Group notified about this change's progress. */
  groupId: string;

  status: "open" | "merged" | "closed";
  /** Latest derived CI verdict: true=passing, false=failing, null=unknown/running. */
  ciPassing: boolean | null;
  reviewDecision: "approved" | "changes_requested" | "review_required" | null;
  /** Compact status summary from the last poll; the watcher notifies only on change. */
  lastSummary: string;

  lastPolledAt: Date | null;
  mergedAt: Date | null;
  closedAt: Date | null;
}

export type InfraChangeDocument = DefaultDoc & InfraChangeFields;
export type InfraChangeStatics = DefaultStatics<InfraChangeDocument>;
export type InfraChangeModel = DefaultModel<InfraChangeDocument> & InfraChangeStatics;
export type InfraChangeSchema = mongoose.Schema<InfraChangeDocument, InfraChangeModel>;
