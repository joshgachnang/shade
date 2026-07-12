import mongoose from "mongoose";
import type {AppleCalendarDocument, AppleCalendarModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const appleCalendarSchema = new mongoose.Schema<AppleCalendarDocument, AppleCalendarModel>(
  {
    externalId: {type: String, required: true, unique: true},
    name: {type: String, required: true, trim: true},
    description: {type: String},
    isDefault: {type: Boolean, default: false},
    writable: {type: Boolean, default: true},
    agentId: {type: mongoose.Schema.Types.ObjectId, ref: "EdgeAgent"},
    lastSyncedAt: {type: Date},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

appleCalendarSchema.index({name: 1});

addDefaultPlugins(appleCalendarSchema);

export const AppleCalendar = mongoose.model<AppleCalendarDocument, AppleCalendarModel>(
  "AppleCalendar",
  appleCalendarSchema
);
