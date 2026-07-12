import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface AppleCalendarFields {
  /** EventKit calendarIdentifier of the calendar on the source Mac. */
  externalId: string;
  name: string;
  /** User-provided context about what this calendar is for; used by the agent to pick the right calendar. */
  description?: string;
  /** When true, this calendar is the fallback target for new events without an explicit calendar. */
  isDefault: boolean;
  writable: boolean;
  agentId?: mongoose.Types.ObjectId;
  lastSyncedAt?: Date;
}

export type AppleCalendarDocument = DefaultDoc & AppleCalendarFields;
export type AppleCalendarStatics = DefaultStatics<AppleCalendarDocument>;
export type AppleCalendarModel = DefaultModel<AppleCalendarDocument> & AppleCalendarStatics;
export type AppleCalendarSchema = mongoose.Schema<AppleCalendarDocument, AppleCalendarModel>;
