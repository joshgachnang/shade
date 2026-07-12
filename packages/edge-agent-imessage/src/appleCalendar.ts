import type {CalendarEventPayload, CalendarPayload} from "@shade/edge-agent-types";
import {DateTime} from "luxon";
import {runJxa} from "./jxa";
import {expandRecurrence} from "./rrule";

export interface CalendarSnapshot {
  calendars: CalendarPayload[];
  events: CalendarEventPayload[];
}

export interface FetchCalendarEventsInput {
  startDate: string; // ISO 8601
  endDate: string; // ISO 8601
  calendarFilters?: string[]; // calendar names; empty/undefined = all calendars
}

export interface CreateCalendarEventInput {
  title: string;
  calendarName?: string;
  startDate: string; // ISO 8601
  endDate: string; // ISO 8601
  allDay?: boolean;
  location?: string;
  notes?: string;
}

export interface CreatedCalendarEvent {
  externalId: string;
  calendarName: string;
}

interface RawCalendarEvent {
  uid: string;
  title: string;
  notes: string | null;
  location: string | null;
  url: string | null;
  startDate: string;
  endDate: string;
  allDay: boolean;
  status: string | null;
  recurrence: string | null;
  calendarName: string;
  calendarExternalId: string;
}

interface RawSnapshot {
  calendars: CalendarPayload[];
  inWindow: RawCalendarEvent[];
  recurringMasters: RawCalendarEvent[];
}

/**
 * Fetch all calendars plus every event occurrence in [startDate, endDate).
 * Calendar.app scripting (Apple events — the only automation path that can
 * prompt for consent from a launchd binary; see appleReminders.ts) returns
 * recurring series as a single master event, so occurrences are expanded here
 * from the RRULE. Each expanded occurrence gets a stable externalId of
 * "<uid>/<occurrence ISO>"; the master keeps its plain uid.
 */
export const fetchCalendarSnapshot = async (
  input: FetchCalendarEventsInput
): Promise<CalendarSnapshot> => {
  const script = `
const app = Application("Calendar");
const args = ${JSON.stringify(input)};

const rangeStart = new Date(args.startDate);
const rangeEnd = new Date(args.endDate);
const filters = (args.calendarFilters || []).map((f) => f.toLowerCase());

const allCalendars = app.calendars();
const calendars = [];
const inWindow = [];
const recurringMasters = [];

const collect = (matches, calName, calId, target) => {
  const uids = matches.uid();
  const titles = matches.summary();
  const starts = matches.startDate();
  const ends = matches.endDate();
  const allDays = matches.alldayEvent();
  let locations = [];
  let notes = [];
  let urls = [];
  let statuses = [];
  let recurrences = [];
  try { locations = matches.location(); } catch (_e) {}
  try { notes = matches.description(); } catch (_e) {}
  try { urls = matches.url(); } catch (_e) {}
  try { statuses = matches.status(); } catch (_e) {}
  try { recurrences = matches.recurrence(); } catch (_e) {}

  for (let j = 0; j < uids.length; j++) {
    if (!uids[j] || !starts[j] || !ends[j]) {
      continue;
    }
    target.push({
      uid: uids[j],
      title: titles[j] || "",
      notes: notes[j] || null,
      location: locations[j] || null,
      url: urls[j] || null,
      startDate: starts[j].toISOString(),
      endDate: ends[j].toISOString(),
      allDay: !!allDays[j],
      status: statuses[j] ? String(statuses[j]) : null,
      recurrence: recurrences[j] || null,
      calendarName: calName,
      calendarExternalId: calId,
    });
  }
};

for (let i = 0; i < allCalendars.length; i++) {
  const cal = allCalendars[i];
  const calName = cal.name();
  if (filters.length > 0 && !filters.includes(calName.toLowerCase())) {
    continue;
  }
  const calId = cal.uid();
  let writable = true;
  try { writable = cal.writable(); } catch (_e) {}
  calendars.push({externalId: calId, name: calName, writable});

  try {
    const matches = cal.events.whose({
      _and: [{startDate: {_greaterThanEquals: rangeStart}}, {startDate: {_lessThan: rangeEnd}}],
    });
    collect(matches, calName, calId, inWindow);
  } catch (_e) {}

  try {
    const masters = cal.events.whose({
      _and: [{startDate: {_lessThan: rangeStart}}, {recurrence: {_beginsWith: "FREQ"}}],
    });
    collect(masters, calName, calId, recurringMasters);
  } catch (_e) {}
}

JSON.stringify({calendars, inWindow, recurringMasters});
`;

  const output = await runJxa(script);
  const raw = JSON.parse(output) as RawSnapshot;
  return {
    calendars: raw.calendars,
    events: expandSnapshotEvents(raw, input.startDate, input.endDate),
  };
};

/** Exported for tests: turns raw masters + in-window events into occurrence rows. */
export const expandSnapshotEvents = (
  raw: Pick<RawSnapshot, "inWindow" | "recurringMasters">,
  windowStartIso: string,
  windowEndIso: string
): CalendarEventPayload[] => {
  const windowStart = DateTime.fromISO(windowStartIso);
  const windowEnd = DateTime.fromISO(windowEndIso);
  const events: CalendarEventPayload[] = [];
  const seen = new Set<string>();

  const pushEvent = (event: CalendarEventPayload): void => {
    if (!seen.has(event.externalId)) {
      seen.add(event.externalId);
      events.push(event);
    }
  };

  const emitOccurrences = (master: RawCalendarEvent, includeSeriesStart: boolean): void => {
    if (!master.recurrence) {
      return;
    }
    const seriesStart = DateTime.fromISO(master.startDate);
    const durationMs =
      DateTime.fromISO(master.endDate).toMillis() - seriesStart.toMillis();
    const occurrences = expandRecurrence({
      rrule: master.recurrence,
      seriesStart,
      windowStart,
      windowEnd,
    });
    for (const occurrence of occurrences) {
      if (!includeSeriesStart && occurrence.equals(seriesStart)) {
        continue;
      }
      const startIso = occurrence.toUTC().toISO();
      const endIso = occurrence.plus({milliseconds: durationMs}).toUTC().toISO();
      if (!startIso || !endIso) {
        continue;
      }
      const isSeriesStart = occurrence.equals(seriesStart);
      pushEvent({
        externalId: isSeriesStart ? master.uid : `${master.uid}/${startIso}`,
        title: master.title,
        notes: master.notes,
        location: master.location,
        url: master.url,
        startDate: startIso,
        endDate: endIso,
        allDay: master.allDay,
        status: master.status,
        calendarName: master.calendarName,
        calendarExternalId: master.calendarExternalId,
      });
    }
  };

  for (const event of raw.inWindow) {
    pushEvent({
      externalId: event.uid,
      title: event.title,
      notes: event.notes,
      location: event.location,
      url: event.url,
      startDate: event.startDate,
      endDate: event.endDate,
      allDay: event.allDay,
      status: event.status,
      calendarName: event.calendarName,
      calendarExternalId: event.calendarExternalId,
    });
    if (event.recurrence) {
      emitOccurrences(event, false);
    }
  }

  for (const master of raw.recurringMasters) {
    emitOccurrences(master, true);
  }

  return events;
};

/**
 * Create a calendar event. If calendarName is omitted or doesn't match a
 * writable calendar (case-insensitive), the first writable calendar is used.
 */
export const createCalendarEvent = async (
  input: CreateCalendarEventInput
): Promise<CreatedCalendarEvent> => {
  const script = `
const app = Application("Calendar");
const args = ${JSON.stringify(input)};

const startDate = new Date(args.startDate);
const endDate = new Date(args.endDate);
if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
  throw new Error("Invalid startDate/endDate");
}

const allCalendars = app.calendars();
const isWritable = (cal) => {
  try {
    return cal.writable();
  } catch (_e) {
    return true;
  }
};

let target = null;
if (args.calendarName) {
  for (let i = 0; i < allCalendars.length; i++) {
    if (
      allCalendars[i].name().toLowerCase() === args.calendarName.toLowerCase() &&
      isWritable(allCalendars[i])
    ) {
      target = allCalendars[i];
      break;
    }
  }
}
if (!target) {
  for (let i = 0; i < allCalendars.length; i++) {
    if (isWritable(allCalendars[i])) {
      target = allCalendars[i];
      break;
    }
  }
}
if (!target) {
  throw new Error("No writable calendar found");
}

const props = {summary: args.title, startDate, endDate};
if (args.allDay) {
  props.alldayEvent = true;
}
if (args.location) {
  props.location = args.location;
}
if (args.notes) {
  props.description = args.notes;
}

const event = app.Event(props);
target.events.push(event);

JSON.stringify({externalId: event.uid(), calendarName: target.name()});
`;

  const output = await runJxa(script);
  return JSON.parse(output) as CreatedCalendarEvent;
};
