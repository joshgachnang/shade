import mongoose from "mongoose";
import type { RemoteAgentDocument, RemoteAgentModel } from "../types";
import { addDefaultPlugins } from "./modelPlugins";

const remoteAgentSchema = new mongoose.Schema<RemoteAgentDocument, RemoteAgentModel>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    capabilities: [{ type: String }],
    status: { type: String, default: "offline", enum: ["online", "offline", "busy"] },
    lastHeartbeatAt: { type: Date },
    connectionInfo: {
      host: { type: String },
      port: { type: Number },
      platform: { type: String },
    },
    authToken: { type: String, required: true },
  },
  { strict: "throw", toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

addDefaultPlugins(remoteAgentSchema);

export const RemoteAgent = mongoose.model<RemoteAgentDocument, RemoteAgentModel>(
  "RemoteAgent",
  remoteAgentSchema,
);
