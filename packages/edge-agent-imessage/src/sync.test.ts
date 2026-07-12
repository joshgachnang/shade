import {afterEach, describe, expect, test} from "bun:test";
import type {DataPush} from "@shade/edge-agent-types";
import {DateTime} from "luxon";
import {createCalendarEvent, fetchCalendarSnapshot} from "./appleCalendar";
import {createReminder, fetchRemindersSnapshot} from "./appleReminders";
import {resetRunJxa, setRunJxa} from "./jxa";
import {buildCalendarSyncPush, buildRemindersSyncPush, getCalendarSyncRange} from "./sync";

afterEach(() => {
  resetRunJxa();
});

describe("getCalendarSyncRange", () => {
  test("spans start of the current week through daysAhead", () => {
    const now = DateTime.fromISO("2026-07-11T12:00:00", {zone: "utc"}); // a Saturday
    const {rangeStart, rangeEnd} = getCalendarSyncRange(90, now);
    // Luxon weeks start Monday
    expect(rangeStart).toBe("2026-07-06T00:00:00.000Z");
    expect(DateTime.fromISO(rangeEnd).diff(now, "days").days).toBeGreaterThanOrEqual(90);
  });
});

describe("fetchRemindersSnapshot", () => {
  test("parses the JXA JSON output", async () => {
    const snapshot = {
      lists: [{externalId: "l1", name: "Groceries"}],
      reminders: [
        {
          externalId: "r1",
          title: "Buy milk",
          notes: null,
          dueDate: "2026-07-12T09:00:00.000Z",
          priority: 0,
          completed: false,
          listName: "Groceries",
          listExternalId: "l1",
        },
      ],
    };
    setRunJxa(async () => JSON.stringify(snapshot));

    const result = await fetchRemindersSnapshot();
    expect(result.lists.length).toBe(1);
    expect(result.reminders[0].title).toBe("Buy milk");
  });
});

describe("createReminder", () => {
  test("embeds the input as JSON in the script and parses the result", async () => {
    let capturedScript = "";
    setRunJxa(async (script) => {
      capturedScript = script;
      return JSON.stringify({externalId: "new-1", listName: "Groceries"});
    });

    const created = await createReminder({
      title: 'Buy "fancy" milk',
      listName: "Groceries",
      dueDate: "2026-07-12T09:00:00",
    });

    expect(created.externalId).toBe("new-1");
    expect(capturedScript).toContain(JSON.stringify('Buy "fancy" milk'));
    expect(capturedScript).toContain("Groceries");
  });
});

describe("fetchCalendarSnapshot", () => {
  test("passes the range and filters into the script", async () => {
    let capturedScript = "";
    setRunJxa(async (script) => {
      capturedScript = script;
      return JSON.stringify({calendars: [], inWindow: [], recurringMasters: []});
    });

    await fetchCalendarSnapshot({
      startDate: "2026-07-06T00:00:00.000Z",
      endDate: "2026-10-09T00:00:00.000Z",
      calendarFilters: ["Family"],
    });

    expect(capturedScript).toContain("2026-07-06T00:00:00.000Z");
    expect(capturedScript).toContain("Family");
  });

  test("expands recurring masters into occurrence rows", async () => {
    setRunJxa(async () =>
      JSON.stringify({
        calendars: [{externalId: "c1", name: "Work", writable: true}],
        inWindow: [],
        recurringMasters: [
          {
            uid: "series-1",
            title: "Standup",
            notes: null,
            location: null,
            url: null,
            // Series started long before the window, weekly on its start weekday
            startDate: "2026-01-05T17:00:00.000Z", // a Monday
            endDate: "2026-01-05T17:15:00.000Z",
            allDay: false,
            status: "confirmed",
            recurrence: "FREQ=WEEKLY;INTERVAL=1",
            calendarName: "Work",
            calendarExternalId: "c1",
          },
        ],
      })
    );

    const snapshot = await fetchCalendarSnapshot({
      startDate: "2026-07-06T00:00:00.000Z",
      endDate: "2026-07-20T00:00:00.000Z",
    });

    expect(snapshot.events.length).toBe(2); // two Mondays in the window
    expect(snapshot.events[0].externalId).toStartWith("series-1/");
    expect(snapshot.events[0].title).toBe("Standup");
    // 15-minute duration carried onto each occurrence
    const start = DateTime.fromISO(snapshot.events[0].startDate);
    const end = DateTime.fromISO(snapshot.events[0].endDate);
    expect(end.diff(start, "minutes").minutes).toBe(15);
  });
});

describe("createCalendarEvent", () => {
  test("parses the created event result", async () => {
    setRunJxa(async () => JSON.stringify({externalId: "evt-1", calendarName: "Family"}));

    const created = await createCalendarEvent({
      title: "Soccer practice",
      startDate: "2026-07-14T17:00:00",
      endDate: "2026-07-14T18:00:00",
    });

    expect(created.externalId).toBe("evt-1");
    expect(created.calendarName).toBe("Family");
  });
});

describe("sync push builders", () => {
  test("buildRemindersSyncPush wraps the snapshot in a reminders_sync push", async () => {
    setRunJxa(async () =>
      JSON.stringify({
        lists: [{externalId: "l1", name: "Groceries"}],
        reminders: [],
      })
    );

    const push: DataPush = await buildRemindersSyncPush();
    expect(push.type).toBe("reminders_sync");
    if (push.type === "reminders_sync") {
      expect(push.payload.lists.length).toBe(1);
      expect(push.payload.syncedAt).toBeTruthy();
    }
  });

  test("buildCalendarSyncPush wraps the snapshot with the synced range", async () => {
    setRunJxa(async () =>
      JSON.stringify({calendars: [], inWindow: [], recurringMasters: []})
    );

    const push: DataPush = await buildCalendarSyncPush(30);
    expect(push.type).toBe("calendar_sync");
    if (push.type === "calendar_sync") {
      expect(push.payload.rangeStart).toBeTruthy();
      expect(
        DateTime.fromISO(push.payload.rangeEnd) > DateTime.fromISO(push.payload.rangeStart)
      ).toBe(true);
    }
  });
});
