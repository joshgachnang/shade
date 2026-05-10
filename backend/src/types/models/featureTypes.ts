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

export interface FeatureFields {
  name: string;
  description?: string;
  groupId?: mongoose.Types.ObjectId;
  status: "planned" | "in_progress" | "paused" | "complete" | "error";
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
