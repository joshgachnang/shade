import mongoose from "mongoose";
import type {CalendarEventDocument, CalendarEventModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const calendarEventSchema = new mongoose.Schema<CalendarEventDocument, CalendarEventModel>(
  {
    externalId: {type: String, required: true, unique: true},
    title: {type: String, required: true},
    notes: {type: String},
    location: {type: String},
    url: {type: String},
    startDate: {type: Date, required: true},
    endDate: {type: Date, required: true},
    allDay: {type: Boolean, default: false},
    status: {type: String},
    calendarName: {type: String, required: true},
    calendarExternalId: {type: String, required: true},
    syncStatus: {type: String, enum: ["active", "removed"], default: "active"},
    agentId: {type: mongoose.Schema.Types.ObjectId, ref: "EdgeAgent"},
    lastSyncedAt: {type: Date},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

calendarEventSchema.index({startDate: 1});
calendarEventSchema.index({calendarName: 1, startDate: 1});
calendarEventSchema.index({syncStatus: 1, startDate: 1});

addDefaultPlugins(calendarEventSchema);

export const CalendarEvent = mongoose.model<CalendarEventDocument, CalendarEventModel>(
  "CalendarEvent",
  calendarEventSchema
);
