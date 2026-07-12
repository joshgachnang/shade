import type {CalendarSyncPush, RemindersSyncPush} from "@shade/edge-agent-types";
import {logger} from "@terreno/api";
import type mongoose from "mongoose";
import {AppleCalendar} from "../models/appleCalendarModel";
import {CalendarEvent} from "../models/calendarEvent";
import {Reminder} from "../models/reminder";
import {ReminderList} from "../models/reminderList";

export interface SyncCounts {
  upserted: number;
  removed: number;
}

/**
 * Apply a full reminders snapshot from an edge agent. Upserts lists and
 * reminders by externalId; reminders no longer present in the snapshot (they
 * were completed or deleted on the device) are marked syncStatus "removed".
 * User-curated fields (description, isDefault) are never overwritten.
 */
export const applyRemindersSync = async (
  agentId: mongoose.Types.ObjectId,
  payload: RemindersSyncPush["payload"]
): Promise<SyncCounts> => {
  const syncedAt = new Date(payload.syncedAt);

  for (const list of payload.lists) {
    await ReminderList.findOneAndUpdate(
      {externalId: list.externalId},
      {
        $set: {name: list.name, agentId, lastSyncedAt: syncedAt},
        $setOnInsert: {isDefault: false},
      },
      {upsert: true}
    );
  }

  for (const reminder of payload.reminders) {
    await Reminder.findOneAndUpdate(
      {externalId: reminder.externalId},
      {
        $set: {
          title: reminder.title,
          notes: reminder.notes ?? undefined,
          dueDate: reminder.dueDate ? new Date(reminder.dueDate) : undefined,
          priority: reminder.priority,
          completed: reminder.completed,
          listName: reminder.listName,
          listExternalId: reminder.listExternalId,
          syncStatus: "active",
          agentId,
          lastSyncedAt: syncedAt,
        },
      },
      {upsert: true}
    );
  }

  const snapshotIds = payload.reminders.map((r) => r.externalId);
  const removedResult = await Reminder.updateMany(
    {externalId: {$nin: snapshotIds}, syncStatus: "active"},
    {$set: {syncStatus: "removed", lastSyncedAt: syncedAt}}
  );

  logger.info(
    `Reminders sync applied: ${payload.lists.length} list(s), ${payload.reminders.length} reminder(s), ${removedResult.modifiedCount} removed`
  );

  return {upserted: payload.reminders.length, removed: removedResult.modifiedCount};
};

/**
 * Apply a full calendar snapshot from an edge agent for the pushed window.
 * Upserts calendars and events by externalId; active events whose start falls
 * inside [rangeStart, rangeEnd) but are missing from the snapshot are marked
 * syncStatus "removed". Events outside the window are left untouched.
 * User-curated fields (description, isDefault) are never overwritten.
 */
export const applyCalendarSync = async (
  agentId: mongoose.Types.ObjectId,
  payload: CalendarSyncPush["payload"]
): Promise<SyncCounts> => {
  const syncedAt = new Date(payload.syncedAt);

  for (const calendar of payload.calendars) {
    await AppleCalendar.findOneAndUpdate(
      {externalId: calendar.externalId},
      {
        $set: {
          name: calendar.name,
          writable: calendar.writable ?? true,
          agentId,
          lastSyncedAt: syncedAt,
        },
        $setOnInsert: {isDefault: false},
      },
      {upsert: true}
    );
  }

  for (const event of payload.events) {
    await CalendarEvent.findOneAndUpdate(
      {externalId: event.externalId},
      {
        $set: {
          title: event.title,
          notes: event.notes ?? undefined,
          location: event.location ?? undefined,
          url: event.url ?? undefined,
          startDate: new Date(event.startDate),
          endDate: new Date(event.endDate),
          allDay: event.allDay,
          status: event.status ?? undefined,
          calendarName: event.calendarName,
          calendarExternalId: event.calendarExternalId,
          syncStatus: "active",
          agentId,
          lastSyncedAt: syncedAt,
        },
      },
      {upsert: true}
    );
  }

  const snapshotIds = payload.events.map((e) => e.externalId);
  const removedResult = await CalendarEvent.updateMany(
    {
      externalId: {$nin: snapshotIds},
      syncStatus: "active",
      startDate: {$gte: new Date(payload.rangeStart), $lt: new Date(payload.rangeEnd)},
    },
    {$set: {syncStatus: "removed", lastSyncedAt: syncedAt}}
  );

  logger.info(
    `Calendar sync applied: ${payload.calendars.length} calendar(s), ${payload.events.length} event(s), ${removedResult.modifiedCount} removed`
  );

  return {upserted: payload.events.length, removed: removedResult.modifiedCount};
};
