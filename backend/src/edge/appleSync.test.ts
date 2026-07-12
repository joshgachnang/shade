import {beforeEach, describe, expect, test} from "bun:test";
import mongoose from "mongoose";
import {AppleCalendar} from "../models/appleCalendarModel";
import {CalendarEvent} from "../models/calendarEvent";
import {Reminder} from "../models/reminder";
import {ReminderList} from "../models/reminderList";
import {applyCalendarSync, applyRemindersSync} from "./appleSync";

const agentId = new mongoose.Types.ObjectId();

const makeReminderPayload = (overrides: Record<string, unknown> = {}) => ({
  externalId: "rem-1",
  title: "Buy milk",
  notes: null,
  dueDate: "2026-07-12T09:00:00.000Z",
  priority: 0,
  completed: false,
  listName: "Groceries",
  listExternalId: "list-1",
  ...overrides,
});

const makeEventPayload = (overrides: Record<string, unknown> = {}) => ({
  externalId: "evt-1",
  title: "Dentist",
  notes: null,
  location: null,
  url: null,
  startDate: "2026-07-13T15:00:00.000Z",
  endDate: "2026-07-13T16:00:00.000Z",
  allDay: false,
  status: "confirmed",
  calendarName: "Personal",
  calendarExternalId: "cal-1",
  ...overrides,
});

beforeEach(async () => {
  await Promise.all([
    ReminderList.deleteMany({}),
    Reminder.deleteMany({}),
    AppleCalendar.deleteMany({}),
    CalendarEvent.deleteMany({}),
  ]);
});

describe("applyRemindersSync", () => {
  test("initial sync creates lists and active reminders", async () => {
    const counts = await applyRemindersSync(agentId, {
      lists: [{externalId: "list-1", name: "Groceries"}],
      reminders: [makeReminderPayload()],
      syncedAt: "2026-07-11T00:00:00.000Z",
    });

    expect(counts.upserted).toBe(1);
    const list = await ReminderList.findOneOrNone({externalId: "list-1"});
    expect(list?.name).toBe("Groceries");
    const reminder = await Reminder.findOneOrNone({externalId: "rem-1"});
    expect(reminder?.title).toBe("Buy milk");
    expect(reminder?.syncStatus).toBe("active");
    expect(reminder?.dueDate?.toISOString()).toBe("2026-07-12T09:00:00.000Z");
  });

  test("re-sync updates changed reminders and marks missing ones removed", async () => {
    await applyRemindersSync(agentId, {
      lists: [{externalId: "list-1", name: "Groceries"}],
      reminders: [
        makeReminderPayload(),
        makeReminderPayload({externalId: "rem-2", title: "Buy eggs"}),
      ],
      syncedAt: "2026-07-11T00:00:00.000Z",
    });

    const counts = await applyRemindersSync(agentId, {
      lists: [{externalId: "list-1", name: "Groceries"}],
      reminders: [makeReminderPayload({title: "Buy oat milk"})],
      syncedAt: "2026-07-11T01:00:00.000Z",
    });

    expect(counts.removed).toBe(1);
    const updated = await Reminder.findOneOrNone({externalId: "rem-1"});
    expect(updated?.title).toBe("Buy oat milk");
    expect(updated?.syncStatus).toBe("active");
    const removed = await Reminder.findOneOrNone({externalId: "rem-2"});
    expect(removed?.syncStatus).toBe("removed");
  });

  test("re-sync preserves user-curated list description and isDefault", async () => {
    await applyRemindersSync(agentId, {
      lists: [{externalId: "list-1", name: "Groceries"}],
      reminders: [],
      syncedAt: "2026-07-11T00:00:00.000Z",
    });
    await ReminderList.updateOne(
      {externalId: "list-1"},
      {$set: {description: "Weekly shopping", isDefault: true}}
    );

    await applyRemindersSync(agentId, {
      lists: [{externalId: "list-1", name: "Groceries"}],
      reminders: [],
      syncedAt: "2026-07-11T01:00:00.000Z",
    });

    const list = await ReminderList.findOneOrNone({externalId: "list-1"});
    expect(list?.description).toBe("Weekly shopping");
    expect(list?.isDefault).toBe(true);
  });
});

describe("applyCalendarSync", () => {
  const basePayload = {
    calendars: [{externalId: "cal-1", name: "Personal", writable: true}],
    rangeStart: "2026-07-06T00:00:00.000Z",
    rangeEnd: "2026-10-09T00:00:00.000Z",
    syncedAt: "2026-07-11T00:00:00.000Z",
  };

  test("initial sync creates calendars and active events", async () => {
    const counts = await applyCalendarSync(agentId, {
      ...basePayload,
      events: [makeEventPayload()],
    });

    expect(counts.upserted).toBe(1);
    const calendar = await AppleCalendar.findOneOrNone({externalId: "cal-1"});
    expect(calendar?.name).toBe("Personal");
    expect(calendar?.writable).toBe(true);
    const event = await CalendarEvent.findOneOrNone({externalId: "evt-1"});
    expect(event?.title).toBe("Dentist");
    expect(event?.syncStatus).toBe("active");
  });

  test("re-sync only removes missing events inside the synced window", async () => {
    await applyCalendarSync(agentId, {
      ...basePayload,
      events: [makeEventPayload(), makeEventPayload({externalId: "evt-2", title: "Standup"})],
    });
    // An event outside the new window (e.g. from an older, wider sync)
    await CalendarEvent.create({
      externalId: "evt-old",
      title: "Past thing",
      startDate: new Date("2026-06-01T10:00:00.000Z"),
      endDate: new Date("2026-06-01T11:00:00.000Z"),
      allDay: false,
      calendarName: "Personal",
      calendarExternalId: "cal-1",
      syncStatus: "active",
    });

    const counts = await applyCalendarSync(agentId, {
      ...basePayload,
      events: [makeEventPayload()],
    });

    expect(counts.removed).toBe(1);
    const kept = await CalendarEvent.findOneOrNone({externalId: "evt-1"});
    expect(kept?.syncStatus).toBe("active");
    const removed = await CalendarEvent.findOneOrNone({externalId: "evt-2"});
    expect(removed?.syncStatus).toBe("removed");
    const outsideWindow = await CalendarEvent.findOneOrNone({externalId: "evt-old"});
    expect(outsideWindow?.syncStatus).toBe("active");
  });

  test("re-sync preserves user-curated calendar description and isDefault", async () => {
    await applyCalendarSync(agentId, {...basePayload, events: []});
    await AppleCalendar.updateOne(
      {externalId: "cal-1"},
      {$set: {description: "My personal stuff", isDefault: true}}
    );

    await applyCalendarSync(agentId, {...basePayload, events: []});

    const calendar = await AppleCalendar.findOneOrNone({externalId: "cal-1"});
    expect(calendar?.description).toBe("My personal stuff");
    expect(calendar?.isDefault).toBe(true);
  });
});
