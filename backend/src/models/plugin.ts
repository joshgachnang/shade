import mongoose from "mongoose";
import type {PluginDocument, PluginModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const pluginSchema = new mongoose.Schema<PluginDocument, PluginModel>(
  {
    name: {type: String, required: true, trim: true, unique: true},
    path: {type: String, required: true},
    enabled: {type: Boolean, default: true},
    hooks: [{type: String}],
    config: {type: mongoose.Schema.Types.Mixed, default: {}},
    version: {type: String},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

addDefaultPlugins(pluginSchema);

export const Plugin = mongoose.model<PluginDocument, PluginModel>("Plugin", pluginSchema);
