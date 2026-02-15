import mongoose from "mongoose";
import type { AgentSessionDocument, AgentSessionModel } from "../types";
import { addDefaultPlugins } from "./modelPlugins";

const agentSessionSchema = new mongoose.Schema<AgentSessionDocument, AgentSessionModel>(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true },
    sessionId: { type: String, required: true, unique: true },
    transcriptPath: { type: String, required: true },
    status: { type: String, default: "active", enum: ["active", "closed", "archived"] },
    messageCount: { type: Number, default: 0 },
    lastActivityAt: { type: Date },
    resumeSessionAt: { type: String },
  },
  { strict: "throw", toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

addDefaultPlugins(agentSessionSchema);

export const AgentSession = mongoose.model<AgentSessionDocument, AgentSessionModel>(
  "AgentSession",
  agentSessionSchema,
);
