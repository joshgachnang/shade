import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface CalendarConfigFields {
  name: string;
  enabledCalendars: string[];
  owner: mongoose.Types.ObjectId;
}

export type CalendarConfigDocument = DefaultDoc & CalendarConfigFields;
export type CalendarConfigStatics = DefaultStatics<CalendarConfigDocument>;
export type CalendarConfigModel = DefaultModel<CalendarConfigDocument> & CalendarConfigStatics;
export type CalendarConfigSchema = mongoose.Schema<CalendarConfigDocument, CalendarConfigModel>;
