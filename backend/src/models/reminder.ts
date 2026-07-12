import mongoose from "mongoose";
import type {ReminderDocument, ReminderModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const reminderSchema = new mongoose.Schema<ReminderDocument, ReminderModel>(
  {
    externalId: {type: String, required: true, unique: true},
    title: {type: String, required: true},
    notes: {type: String},
    dueDate: {type: Date},
    priority: {type: Number, default: 0},
    completed: {type: Boolean, default: false},
    completedAt: {type: Date},
    listName: {type: String, required: true},
    listExternalId: {type: String, required: true},
    syncStatus: {type: String, enum: ["active", "removed"], default: "active"},
    agentId: {type: mongoose.Schema.Types.ObjectId, ref: "EdgeAgent"},
    lastSyncedAt: {type: Date},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

reminderSchema.index({syncStatus: 1, listName: 1});
reminderSchema.index({dueDate: 1});

addDefaultPlugins(reminderSchema);

export const Reminder = mongoose.model<ReminderDocument, ReminderModel>("Reminder", reminderSchema);
