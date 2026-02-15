import mongoose from "mongoose";
import type { CommandClassificationDocument, CommandClassificationModel } from "../types";
import { addDefaultPlugins } from "./modelPlugins";

const commandClassificationSchema = new mongoose.Schema<
  CommandClassificationDocument,
  CommandClassificationModel
>(
  {
    pattern: { type: String, required: true },
    classification: {
      type: String,
      required: true,
      enum: ["public", "internal", "sensitive", "critical"],
    },
    routeTo: { type: String, enum: ["claude", "ollama", "codex"] },
    description: { type: String },
    priority: { type: Number, default: 0 },
  },
  { strict: "throw", toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

addDefaultPlugins(commandClassificationSchema);

export const CommandClassification = mongoose.model<
  CommandClassificationDocument,
  CommandClassificationModel
>("CommandClassification", commandClassificationSchema);
