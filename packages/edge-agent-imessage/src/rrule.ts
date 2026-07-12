import {DateTime} from "luxon";

export interface ExpandRecurrenceInput {
  rrule: string; // e.g. "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE"
  seriesStart: DateTime;
  windowStart: DateTime;
  windowEnd: DateTime;
  maxOccurrences?: number;
}

const WEEKDAYS: Record<string, number> = {MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7};

const parseUntil = (value: string): DateTime | null => {
  // UNTIL comes as 20261231T000000Z or 20261231
  const iso = value.includes("T")
    ? value.replace(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/,
        "$1-$2-$3T$4:$5:$6$7"
      )
    : value.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
  const parsed = DateTime.fromISO(iso, {zone: "utc"});
  return parsed.isValid ? parsed : null;
};

/**
 * Expand an iCalendar RRULE into occurrence start times within
 * [windowStart, windowEnd). Supports the recurrence shapes Calendar.app
 * commonly produces: FREQ daily/weekly/monthly/yearly with INTERVAL, UNTIL,
 * COUNT, BYDAY (weekly), and BYMONTHDAY (monthly). Unsupported parts are
 * ignored, which can only over-generate — the sync window keeps that bounded.
 * EXDATEs aren't exposed by Calendar scripting, so deleted single occurrences
 * of a series may still appear.
 */
export const expandRecurrence = ({
  rrule,
  seriesStart,
  windowStart,
  windowEnd,
  maxOccurrences = 200,
}: ExpandRecurrenceInput): DateTime[] => {
  const parts: Record<string, string> = {};
  for (const piece of rrule.split(";")) {
    const [key, value] = piece.split("=");
    if (key && value) {
      parts[key.trim().toUpperCase()] = value.trim();
    }
  }

  const freq = parts.FREQ?.toUpperCase();
  if (!freq) {
    return [];
  }

  const interval = Math.max(1, Number.parseInt(parts.INTERVAL ?? "1", 10) || 1);
  const count = parts.COUNT ? Number.parseInt(parts.COUNT, 10) : null;
  const until = parts.UNTIL ? parseUntil(parts.UNTIL) : null;
  const hardEnd = until && until < windowEnd ? until : windowEnd;

  const byDay = parts.BYDAY
    ? parts.BYDAY.split(",")
        // Strip ordinal prefixes like 2MO/-1FR; monthly ordinals aren't supported
        .map((d) => WEEKDAYS[d.replace(/^-?\d+/, "")])
        .filter((d): d is number => d !== undefined)
    : [];
  const byMonthDay = parts.BYMONTHDAY
    ? parts.BYMONTHDAY.split(",")
        .map((d) => Number.parseInt(d, 10))
        .filter((d) => Number.isInteger(d) && d >= 1 && d <= 31)
    : [];

  const occurrences: DateTime[] = [];
  let emitted = 0; // total series occurrences seen (for COUNT), including pre-window ones

  const push = (occurrence: DateTime): boolean => {
    if (count !== null && emitted >= count) {
      return false;
    }
    emitted += 1;
    if (occurrence >= windowStart && occurrence < hardEnd) {
      occurrences.push(occurrence);
      if (occurrences.length >= maxOccurrences) {
        return false;
      }
    }
    return occurrence < hardEnd;
  };

  const maxIterations = 5000;

  if (freq === "DAILY") {
    let cursor = seriesStart;
    for (let i = 0; i < maxIterations; i++) {
      if (!push(cursor)) {
        break;
      }
      cursor = cursor.plus({days: interval});
    }
  } else if (freq === "WEEKLY") {
    const days = byDay.length > 0 ? byDay : [seriesStart.weekday];
    let weekCursor = seriesStart.startOf("week");
    for (let i = 0; i < maxIterations; i++) {
      let keepGoing = true;
      for (const weekday of [...days].sort((a, b) => a - b)) {
        const occurrence = weekCursor.plus({days: weekday - 1}).set({
          hour: seriesStart.hour,
          minute: seriesStart.minute,
          second: seriesStart.second,
        });
        if (occurrence < seriesStart) {
          continue;
        }
        if (!push(occurrence)) {
          keepGoing = false;
          break;
        }
      }
      if (!keepGoing) {
        break;
      }
      weekCursor = weekCursor.plus({weeks: interval});
    }
  } else if (freq === "MONTHLY") {
    const days = byMonthDay.length > 0 ? byMonthDay : [seriesStart.day];
    let monthCursor = seriesStart.startOf("month");
    for (let i = 0; i < maxIterations; i++) {
      let keepGoing = true;
      for (const day of [...days].sort((a, b) => a - b)) {
        if (day > (monthCursor.daysInMonth ?? 28)) {
          continue; // months without this day are skipped, not clamped (RFC 5545)
        }
        const occurrence = monthCursor.set({
          day,
          hour: seriesStart.hour,
          minute: seriesStart.minute,
          second: seriesStart.second,
        });
        if (occurrence < seriesStart) {
          continue;
        }
        if (!push(occurrence)) {
          keepGoing = false;
          break;
        }
      }
      if (!keepGoing) {
        break;
      }
      monthCursor = monthCursor.plus({months: interval});
    }
  } else if (freq === "YEARLY") {
    let cursor = seriesStart;
    for (let i = 0; i < maxIterations; i++) {
      if (!push(cursor)) {
        break;
      }
      cursor = cursor.plus({years: interval});
    }
  } else {
    return [];
  }

  return occurrences;
};
