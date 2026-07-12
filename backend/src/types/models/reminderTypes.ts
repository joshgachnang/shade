import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface ReminderFields {
  /** EventKit calendarItemIdentifier of the reminder on the source Mac. */
  externalId: string;
  title: string;
  notes?: string;
  dueDate?: Date;
  /** Apple priority: 0=none, 1-4=high, 5=medium, 6-9=low. */
  priority: number;
  completed: boolean;
  completedAt?: Date;
  listName: string;
  listExternalId: string;
  /**
   * "active" while present in the latest sync snapshot; "removed" once it
   * disappears (completed or deleted on the device).
   */
  syncStatus: "active" | "removed";
  agentId?: mongoose.Types.ObjectId;
  lastSyncedAt?: Date;
}

export type ReminderDocument = DefaultDoc & ReminderFields;
export type ReminderStatics = DefaultStatics<ReminderDocument>;
export type ReminderModel = DefaultModel<ReminderDocument> & ReminderStatics;
export type ReminderSchema = mongoose.Schema<ReminderDocument, ReminderModel>;
