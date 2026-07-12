import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface CalendarEventFields {
  /**
   * EventKit eventIdentifier; recurring occurrences are suffixed with
   * "/<occurrenceDate ISO>" so each occurrence is a distinct row.
   */
  externalId: string;
  title: string;
  notes?: string;
  location?: string;
  url?: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  /** EventKit event status: none, confirmed, tentative, or canceled. */
  status?: string;
  calendarName: string;
  calendarExternalId: string;
  /**
   * "active" while present in the latest sync snapshot; "removed" once it
   * disappears from the synced window (deleted or moved on the device).
   */
  syncStatus: "active" | "removed";
  agentId?: mongoose.Types.ObjectId;
  lastSyncedAt?: Date;
}

export type CalendarEventDocument = DefaultDoc & CalendarEventFields;
export type CalendarEventStatics = DefaultStatics<CalendarEventDocument>;
export type CalendarEventModel = DefaultModel<CalendarEventDocument> & CalendarEventStatics;
export type CalendarEventSchema = mongoose.Schema<CalendarEventDocument, CalendarEventModel>;
