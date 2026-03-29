import {afterEach, describe, expect, test} from "bun:test";
import {
  createEvent,
  getEvents,
  listCalendars,
  parseCalendarList,
  parseEventList,
  parseEventOutput,
  resetExecAsync,
  setExecAsync,
} from "./appleCalendar";

afterEach(() => {
  resetExecAsync();
});

// ─── Parsing unit tests ──────────────────────────────────────────────────────

describe("parseCalendarList", () => {
  test("parses multiple calendars", () => {
    const output = "Work|||uid-1\nPersonal|||uid-2\nHolidays|||uid-3";
    const result = parseCalendarList(output);

    expect(result).toEqual([
      {name: "Work", id: "uid-1"},
      {name: "Personal", id: "uid-2"},
      {name: "Holidays", id: "uid-3"},
    ]);
  });

  test("returns empty array for empty output", () => {
    expect(parseCalendarList("")).toEqual([]);
  });

  test("handles single calendar", () => {
    const result = parseCalendarList("Home|||abc-123");
    expect(result).toEqual([{name: "Home", id: "abc-123"}]);
  });

  test("trims whitespace from names and ids", () => {
    const result = parseCalendarList("  Work  |||  uid-1  ");
    expect(result).toEqual([{name: "Work", id: "uid-1"}]);
  });

  test("handles missing id gracefully", () => {
    const result = parseCalendarList("Work");
    expect(result).toEqual([{name: "Work", id: ""}]);
  });
});

describe("parseEventList", () => {
  test("parses multiple events", () => {
    const output = [
      "evt-1|||Team Standup|||March 29, 2026 9:00:00 AM|||March 29, 2026 9:30:00 AM|||Zoom|||Daily sync|||Work|||false|||https://zoom.us/123",
      "evt-2|||Lunch|||March 29, 2026 12:00:00 PM|||March 29, 2026 1:00:00 PM||| ||| |||Personal|||false||| ",
    ].join("\n");

    const result = parseEventList(output);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("evt-1");
    expect(result[0].summary).toBe("Team Standup");
    expect(result[0].location).toBe("Zoom");
    expect(result[0].notes).toBe("Daily sync");
    expect(result[0].calendarName).toBe("Work");
    expect(result[0].isAllDay).toBe(false);
    expect(result[0].url).toBe("https://zoom.us/123");

    expect(result[1].id).toBe("evt-2");
    expect(result[1].summary).toBe("Lunch");
    expect(result[1].location).toBe("");
    expect(result[1].notes).toBe("");
    expect(result[1].calendarName).toBe("Personal");
  });

  test("returns empty array for empty output", () => {
    expect(parseEventList("")).toEqual([]);
  });

  test("parses all-day event", () => {
    const output =
      "evt-3|||Holiday|||March 29, 2026 12:00:00 AM|||March 30, 2026 12:00:00 AM||| ||| |||Holidays|||true||| ";
    const result = parseEventList(output);
    expect(result[0].isAllDay).toBe(true);
    expect(result[0].summary).toBe("Holiday");
  });

  test("handles missing fields gracefully", () => {
    const output = "evt-4|||Meeting";
    const result = parseEventList(output);
    expect(result[0].id).toBe("evt-4");
    expect(result[0].summary).toBe("Meeting");
    expect(result[0].startDate).toBe("");
    expect(result[0].location).toBe("");
    expect(result[0].isAllDay).toBe(false);
  });
});

describe("parseEventOutput", () => {
  test("parses a single event", () => {
    const output =
      "new-uid|||My Meeting|||March 29, 2026 2:00:00 PM|||March 29, 2026 3:00:00 PM|||Room 5|||Discuss project|||Work|||false||| ";
    const result = parseEventOutput(output);

    expect(result.id).toBe("new-uid");
    expect(result.summary).toBe("My Meeting");
    expect(result.startDate).toBe("March 29, 2026 2:00:00 PM");
    expect(result.endDate).toBe("March 29, 2026 3:00:00 PM");
    expect(result.location).toBe("Room 5");
    expect(result.notes).toBe("Discuss project");
    expect(result.calendarName).toBe("Work");
    expect(result.isAllDay).toBe(false);
  });

  test("parses all-day event output", () => {
    const output =
      "uid-x|||Day Off|||March 30, 2026 12:00:00 AM|||March 31, 2026 12:00:00 AM||| ||| |||Personal|||true||| ";
    const result = parseEventOutput(output);
    expect(result.isAllDay).toBe(true);
    expect(result.summary).toBe("Day Off");
  });
});

// ─── Integration tests (mock osascript) ──────────────────────────────────────

const mockExec = (stdout: string) => {
  setExecAsync((() => Promise.resolve({stdout, stderr: ""})) as any);
};

const mockExecError = (message: string) => {
  setExecAsync((() => Promise.reject(new Error(message))) as any);
};

describe("listCalendars", () => {
  test("returns parsed calendars from osascript output", async () => {
    mockExec("Work|||uid-1\nPersonal|||uid-2\n");
    const result = await listCalendars();
    expect(result).toEqual([
      {name: "Work", id: "uid-1"},
      {name: "Personal", id: "uid-2"},
    ]);
  });

  test("returns empty array when no calendars", async () => {
    mockExec("");
    const result = await listCalendars();
    expect(result).toEqual([]);
  });

  test("throws on osascript failure", async () => {
    mockExecError("Calendar is not running");
    expect(listCalendars()).rejects.toThrow("AppleScript failed");
  });
});

describe("getEvents", () => {
  test("returns parsed events from osascript output", async () => {
    mockExec(
      "evt-1|||Standup|||March 29, 2026 9:00:00 AM|||March 29, 2026 9:30:00 AM|||Zoom|||Notes|||Work|||false||| "
    );
    const result = await getEvents({
      calendarNames: ["Work"],
      startDate: "2026-03-29T00:00:00",
      endDate: "2026-03-29T23:59:59",
    });

    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe("Standup");
    expect(result[0].calendarName).toBe("Work");
  });

  test("returns empty array when no events", async () => {
    mockExec("");
    const result = await getEvents({
      calendarNames: ["Work"],
      startDate: "2026-03-29T00:00:00",
      endDate: "2026-03-29T23:59:59",
    });
    expect(result).toEqual([]);
  });

  test("throws on invalid start date", async () => {
    expect(
      getEvents({
        calendarNames: ["Work"],
        startDate: "not-a-date",
        endDate: "2026-03-29T23:59:59",
      })
    ).rejects.toThrow("Invalid date format");
  });

  test("throws on invalid end date", async () => {
    expect(
      getEvents({
        calendarNames: ["Work"],
        startDate: "2026-03-29T00:00:00",
        endDate: "nope",
      })
    ).rejects.toThrow("Invalid date format");
  });

  test("throws on osascript failure", async () => {
    mockExecError("access denied");
    expect(
      getEvents({
        calendarNames: ["Work"],
        startDate: "2026-03-29T00:00:00",
        endDate: "2026-03-29T23:59:59",
      })
    ).rejects.toThrow("AppleScript failed");
  });
});

describe("createEvent", () => {
  test("returns parsed created event", async () => {
    mockExec(
      "new-id|||My Meeting|||March 29, 2026 2:00:00 PM|||March 29, 2026 3:00:00 PM|||Room A|||Review|||Work|||false||| "
    );
    const result = await createEvent({
      summary: "My Meeting",
      startDate: "2026-03-29T14:00:00",
      endDate: "2026-03-29T15:00:00",
      calendarName: "Work",
      location: "Room A",
      notes: "Review",
    });

    expect(result.id).toBe("new-id");
    expect(result.summary).toBe("My Meeting");
    expect(result.location).toBe("Room A");
    expect(result.calendarName).toBe("Work");
  });

  test("creates event without optional fields", async () => {
    mockExec(
      "new-id|||Quick Chat|||March 29, 2026 4:00:00 PM|||March 29, 2026 4:30:00 PM||| ||| |||Personal|||false||| "
    );
    const result = await createEvent({
      summary: "Quick Chat",
      startDate: "2026-03-29T16:00:00",
      endDate: "2026-03-29T16:30:00",
      calendarName: "Personal",
    });

    expect(result.id).toBe("new-id");
    expect(result.location).toBe("");
    expect(result.notes).toBe("");
  });

  test("creates all-day event", async () => {
    mockExec(
      "new-id|||Day Off|||March 30, 2026 12:00:00 AM|||March 31, 2026 12:00:00 AM||| ||| |||Personal|||true||| "
    );
    const result = await createEvent({
      summary: "Day Off",
      startDate: "2026-03-30T00:00:00",
      endDate: "2026-03-31T00:00:00",
      calendarName: "Personal",
      isAllDay: true,
    });

    expect(result.isAllDay).toBe(true);
  });

  test("throws on invalid start date", async () => {
    expect(
      createEvent({
        summary: "Test",
        startDate: "bad",
        endDate: "2026-03-29T15:00:00",
        calendarName: "Work",
      })
    ).rejects.toThrow("Invalid date format");
  });

  test("throws on osascript failure", async () => {
    mockExecError("calendar not found");
    expect(
      createEvent({
        summary: "Test",
        startDate: "2026-03-29T14:00:00",
        endDate: "2026-03-29T15:00:00",
        calendarName: "Nonexistent",
      })
    ).rejects.toThrow("AppleScript failed");
  });
});
