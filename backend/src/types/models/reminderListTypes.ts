import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface ReminderListFields {
  /** EventKit calendarIdentifier of the list on the source Mac. */
  externalId: string;
  name: string;
  /** User-provided context about what this list is for; used by the agent to pick the right list. */
  description?: string;
  /** When true, this list is the fallback target for new reminders without an explicit list. */
  isDefault: boolean;
  agentId?: mongoose.Types.ObjectId;
  lastSyncedAt?: Date;
}

export type ReminderListDocument = DefaultDoc & ReminderListFields;
export type ReminderListStatics = DefaultStatics<ReminderListDocument>;
export type ReminderListModel = DefaultModel<ReminderListDocument> & ReminderListStatics;
export type ReminderListSchema = mongoose.Schema<ReminderListDocument, ReminderListModel>;
