import type {CalendarEventPayload, CalendarPayload} from "@shade/edge-agent-types";
import {EVENTKIT_PREAMBLE, runJxa} from "./jxa";

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

const EVENT_STATUS_NAMES = ["none", "confirmed", "tentative", "canceled"];

/**
 * Fetch all calendars plus every event occurrence in [startDate, endDate).
 * Recurring events are expanded into individual occurrences by EventKit; each
 * occurrence gets a stable externalId of "<eventIdentifier>/<occurrenceDate>".
 */
export const fetchCalendarSnapshot = async (
  input: FetchCalendarEventsInput
): Promise<CalendarSnapshot> => {
  const script = `
${EVENTKIT_PREAMBLE}
requestAccess($.EKEntityTypeEvent);

const args = ${JSON.stringify(input)};
const statusNames = ${JSON.stringify(EVENT_STATUS_NAMES)};

const allCalendars = store.calendarsForEntityType($.EKEntityTypeEvent);
const filters = (args.calendarFilters || []).map((f) => f.toLowerCase());
const calendars = [];
const targetCals = [];
for (let i = 0; i < allCalendars.count; i++) {
  const c = allCalendars.objectAtIndex(i);
  const name = ObjC.unwrap(c.title);
  if (filters.length > 0 && !filters.includes(name.toLowerCase())) {
    continue;
  }
  targetCals.push(c);
  calendars.push({
    externalId: ObjC.unwrap(c.calendarIdentifier),
    name,
    writable: !!c.allowsContentModifications,
  });
}

const startDate = $.NSDate.dateWithTimeIntervalSince1970(new Date(args.startDate).getTime() / 1000);
const endDate = $.NSDate.dateWithTimeIntervalSince1970(new Date(args.endDate).getTime() / 1000);
const predicate = store.predicateForEventsWithStartDateEndDateCalendars(
  startDate,
  endDate,
  filters.length > 0 ? targetCals : $()
);
const matched = store.eventsMatchingPredicate(predicate);

const events = [];
const count = matched.count;
for (let i = 0; i < count; i++) {
  const e = matched.objectAtIndex(i);
  if (e.eventIdentifier.isNil()) {
    continue;
  }
  const eventId = ObjC.unwrap(e.eventIdentifier);
  let externalId = eventId;
  if (e.hasRecurrenceRules && !e.occurrenceDate.isNil()) {
    externalId = eventId + "/" + ObjC.unwrap(e.occurrenceDate).toISOString();
  }
  events.push({
    externalId,
    title: e.title.isNil() ? "" : ObjC.unwrap(e.title),
    notes: e.notes.isNil() ? null : ObjC.unwrap(e.notes),
    location: e.location.isNil() ? null : ObjC.unwrap(e.location),
    url: e.URL.isNil() ? null : ObjC.unwrap(e.URL.absoluteString),
    startDate: ObjC.unwrap(e.startDate).toISOString(),
    endDate: ObjC.unwrap(e.endDate).toISOString(),
    allDay: !!e.allDay,
    status: statusNames[Number(e.status)] || null,
    calendarName: ObjC.unwrap(e.calendar.title),
    calendarExternalId: ObjC.unwrap(e.calendar.calendarIdentifier),
  });
}

JSON.stringify({calendars, events});
`;

  const output = await runJxa(script);
  return JSON.parse(output) as CalendarSnapshot;
};

/**
 * Create a calendar event. If calendarName is omitted or doesn't match a
 * writable calendar (case-insensitive), the default calendar for new events is used.
 */
export const createCalendarEvent = async (
  input: CreateCalendarEventInput
): Promise<CreatedCalendarEvent> => {
  const script = `
${EVENTKIT_PREAMBLE}
requestAccess($.EKEntityTypeEvent);

const args = ${JSON.stringify(input)};

let target = null;
if (args.calendarName) {
  const calendars = store.calendarsForEntityType($.EKEntityTypeEvent);
  for (let i = 0; i < calendars.count; i++) {
    const c = calendars.objectAtIndex(i);
    if (
      c.allowsContentModifications &&
      ObjC.unwrap(c.title).toLowerCase() === args.calendarName.toLowerCase()
    ) {
      target = c;
      break;
    }
  }
}
if (!target) {
  target = store.defaultCalendarForNewEvents;
  if (!target || target.isNil()) {
    throw new Error("No target calendar found and no default calendar configured");
  }
}

const startMs = new Date(args.startDate).getTime();
const endMs = new Date(args.endDate).getTime();
if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
  throw new Error("Invalid startDate/endDate");
}

const event = $.EKEvent.eventWithEventStore(store);
event.title = args.title;
event.calendar = target;
event.startDate = $.NSDate.dateWithTimeIntervalSince1970(startMs / 1000);
event.endDate = $.NSDate.dateWithTimeIntervalSince1970(endMs / 1000);
event.allDay = !!args.allDay;
if (args.location) {
  event.location = args.location;
}
if (args.notes) {
  event.notes = args.notes;
}

const err = Ref();
if (!store.saveEventSpanCommitError(event, $.EKSpanThisEvent, true, err)) {
  throw new Error("Failed to save event: " + ObjC.unwrap(err[0].localizedDescription));
}

JSON.stringify({
  externalId: ObjC.unwrap(event.eventIdentifier),
  calendarName: ObjC.unwrap(target.title),
});
`;

  const output = await runJxa(script);
  return JSON.parse(output) as CreatedCalendarEvent;
};
