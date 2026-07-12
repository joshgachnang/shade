import {describe, expect, test} from "bun:test";
import {DateTime} from "luxon";
import {expandRecurrence} from "./rrule";

const dt = (iso: string) => DateTime.fromISO(iso, {zone: "utc"});

describe("expandRecurrence", () => {
  test("daily series lands every day inside the window", () => {
    const occurrences = expandRecurrence({
      rrule: "FREQ=DAILY",
      seriesStart: dt("2026-01-01T09:00:00"),
      windowStart: dt("2026-07-06T00:00:00"),
      windowEnd: dt("2026-07-09T00:00:00"),
    });
    expect(occurrences.length).toBe(3);
    expect(occurrences[0].toISO()).toBe("2026-07-06T09:00:00.000Z");
  });

  test("weekly BYDAY expands to the listed weekdays", () => {
    const occurrences = expandRecurrence({
      rrule: "FREQ=WEEKLY;BYDAY=MO,WE",
      seriesStart: dt("2026-01-05T17:00:00"), // Monday
      windowStart: dt("2026-07-06T00:00:00"), // Monday
      windowEnd: dt("2026-07-13T00:00:00"),
    });
    expect(occurrences.map((o) => o.weekday)).toEqual([1, 3]);
    expect(occurrences[0].hour).toBe(17);
  });

  test("interval skips periods", () => {
    const occurrences = expandRecurrence({
      rrule: "FREQ=WEEKLY;INTERVAL=2",
      seriesStart: dt("2026-06-29T10:00:00"), // Monday
      windowStart: dt("2026-06-29T00:00:00"),
      windowEnd: dt("2026-07-28T00:00:00"),
    });
    expect(occurrences.map((o) => o.toISODate())).toEqual([
      "2026-06-29",
      "2026-07-13",
      "2026-07-27",
    ]);
  });

  test("UNTIL truncates the series", () => {
    const occurrences = expandRecurrence({
      rrule: "FREQ=DAILY;UNTIL=20260708T000000Z",
      seriesStart: dt("2026-07-06T09:00:00"),
      windowStart: dt("2026-07-06T00:00:00"),
      windowEnd: dt("2026-07-20T00:00:00"),
    });
    expect(occurrences.map((o) => o.toISODate())).toEqual(["2026-07-06", "2026-07-07"]);
  });

  test("COUNT limits total occurrences from the series start", () => {
    const occurrences = expandRecurrence({
      rrule: "FREQ=DAILY;COUNT=3",
      seriesStart: dt("2026-07-06T09:00:00"),
      windowStart: dt("2026-07-01T00:00:00"),
      windowEnd: dt("2026-07-20T00:00:00"),
    });
    expect(occurrences.length).toBe(3);
    expect(occurrences[2].toISODate()).toBe("2026-07-08");
  });

  test("monthly keeps the series day-of-month and skips short months", () => {
    const occurrences = expandRecurrence({
      rrule: "FREQ=MONTHLY",
      seriesStart: dt("2026-01-31T12:00:00"),
      windowStart: dt("2026-01-01T00:00:00"),
      windowEnd: dt("2026-05-01T00:00:00"),
    });
    // Jan 31, Mar 31 — February and April have no 31st
    expect(occurrences.map((o) => o.toISODate())).toEqual(["2026-01-31", "2026-03-31"]);
  });

  test("yearly recurs on the series date", () => {
    const occurrences = expandRecurrence({
      rrule: "FREQ=YEARLY",
      seriesStart: dt("2020-07-10T00:00:00"),
      windowStart: dt("2026-07-01T00:00:00"),
      windowEnd: dt("2026-08-01T00:00:00"),
    });
    expect(occurrences.map((o) => o.toISODate())).toEqual(["2026-07-10"]);
  });

  test("unsupported FREQ returns nothing", () => {
    const occurrences = expandRecurrence({
      rrule: "FREQ=HOURLY",
      seriesStart: dt("2026-07-06T09:00:00"),
      windowStart: dt("2026-07-06T00:00:00"),
      windowEnd: dt("2026-07-07T00:00:00"),
    });
    expect(occurrences).toEqual([]);
  });
});
