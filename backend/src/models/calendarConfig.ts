import mongoose from "mongoose";
import type {CalendarConfigDocument, CalendarConfigModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const calendarConfigSchema = new mongoose.Schema<CalendarConfigDocument, CalendarConfigModel>(
  {
    name: {type: String, required: true, trim: true, default: "default"},
    enabledCalendars: {type: [String], default: []},
    owner: {type: mongoose.Schema.Types.ObjectId, ref: "User", required: true},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

addDefaultPlugins(calendarConfigSchema);

export const CalendarConfig = mongoose.model<CalendarConfigDocument, CalendarConfigModel>(
  "CalendarConfig",
  calendarConfigSchema
);
