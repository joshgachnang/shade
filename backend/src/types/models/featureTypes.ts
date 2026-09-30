import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface FeatureStep {
  name: string;
  description?: string;
  order: number;
  status: "pending" | "in_progress" | "complete" | "error" | "skipped";
  startedAt?: Date;
  completedAt?: Date;
  result?: string;
  errorMessage?: string;
}

export type BreweryWorkspace = {kind: "zerg"; session: string} | {kind: "local"; repoPath: string};

export interface BreweryState {
  slug: string;
  repo: string;
  workspace: BreweryWorkspace;
  phase?: string;
  waiting?: {kind: "signoff" | "gate"; since: Date};
  /** Number of bytes already consumed from events.jsonl. */
  eventsOffset: number;
  stepMessages: {
    seq: number;
    ts: string;
    label?: string;
    lines?: string[];
    dirty?: boolean;
    flushedAt?: Date;
    final?: string;
  }[];
  pollLeaseUntil?: Date;
  pr?: number;
  prUrl?: string;
  lastEventAt?: Date;
}

export type FeatureStatus =
  | "planned"
  | "in_progress"
  | "awaiting_approval"
  | "paused"
  | "complete"
  | "error";

export interface FeatureFields {
  name: string;
  description?: string;
  groupId?: mongoose.Types.ObjectId;
  status: FeatureStatus;
  brewery?: BreweryState;
  steps: FeatureStep[];
  currentStepIndex: number;
  startedAt?: Date;
  completedAt?: Date;
  errorMessage?: string;
}

export type FeatureDocument = DefaultDoc & FeatureFields;
export type FeatureStatics = DefaultStatics<FeatureDocument>;
export type FeatureModel = DefaultModel<FeatureDocument> & FeatureStatics;
export type FeatureSchema = mongoose.Schema<FeatureDocument, FeatureModel>;
