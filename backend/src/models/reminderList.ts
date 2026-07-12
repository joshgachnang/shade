import mongoose from "mongoose";
import type {ReminderListDocument, ReminderListModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const reminderListSchema = new mongoose.Schema<ReminderListDocument, ReminderListModel>(
  {
    externalId: {type: String, required: true, unique: true},
    name: {type: String, required: true, trim: true},
    description: {type: String},
    isDefault: {type: Boolean, default: false},
    agentId: {type: mongoose.Schema.Types.ObjectId, ref: "EdgeAgent"},
    lastSyncedAt: {type: Date},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

reminderListSchema.index({name: 1});

addDefaultPlugins(reminderListSchema);

export const ReminderList = mongoose.model<ReminderListDocument, ReminderListModel>(
  "ReminderList",
  reminderListSchema
);
