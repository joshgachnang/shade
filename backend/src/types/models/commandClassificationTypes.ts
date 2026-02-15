import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface CommandClassificationFields {
  pattern: string;
  classification: "public" | "internal" | "sensitive" | "critical";
  routeTo?: "claude" | "ollama" | "codex";
  description?: string;
  priority: number;
}

export type CommandClassificationDocument = DefaultDoc & CommandClassificationFields;
export type CommandClassificationStatics = DefaultStatics<CommandClassificationDocument>;
export type CommandClassificationModel = DefaultModel<CommandClassificationDocument> &
  CommandClassificationStatics;
export type CommandClassificationSchema = mongoose.Schema<
  CommandClassificationDocument,
  CommandClassificationModel
>;
