import type mongoose from "mongoose";
import type { DefaultDoc, DefaultModel, DefaultStatics } from "./userTypes";

export interface PluginFields {
  name: string;
  path: string;
  enabled: boolean;
  hooks: string[];
  config: Record<string, unknown>;
  version?: string;
}

export type PluginDocument = DefaultDoc & PluginFields;
export type PluginStatics = DefaultStatics<PluginDocument>;
export type PluginModel = DefaultModel<PluginDocument> & PluginStatics;
export type PluginSchema = mongoose.Schema<PluginDocument, PluginModel>;
