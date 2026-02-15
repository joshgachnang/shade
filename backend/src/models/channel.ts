import mongoose from "mongoose";
import type {ChannelDocument, ChannelModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const channelSchema = new mongoose.Schema<ChannelDocument, ChannelModel>(
  {
    name: {type: String, required: true, trim: true},
    type: {type: String, required: true, enum: ["slack", "webhook"]},
    status: {type: String, default: "disconnected", enum: ["connected", "disconnected", "error"]},
    config: {type: mongoose.Schema.Types.Mixed, default: {}},
    lastConnectedAt: {type: Date},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

addDefaultPlugins(channelSchema);

export const Channel = mongoose.model<ChannelDocument, ChannelModel>("Channel", channelSchema);
